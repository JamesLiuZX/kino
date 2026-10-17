// Stand-ins for a ComfyUI server (HTTP + WebSocket) and RunPod's Serverless API,
// faithful to the parts of their protocols Kino uses, so providers can be
// tested without a GPU.

import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { proceduralImage } from "../../src/media/png.mjs"

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)))

async function body(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

const json = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

/** Minimal RFC 6455 server side: handshake and unmasked text frames. */
function wsAccept(req, socket) {
  const key = req.headers["sec-websocket-key"]
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  return {
    send(obj) {
      const payload = Buffer.from(JSON.stringify(obj))
      const len = payload.length
      const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : null
      if (!head) throw new Error("frame too big for the fake")
      if (!socket.destroyed) socket.write(Buffer.concat([head, payload]))
    },
  }
}

/**
 * options.mode: "ok" | "missing-model" | "exec-error" | "slow"
 * Records uploads, prompts, interrupts and queue deletes for assertions.
 */
export async function fakeComfy({ mode = "ok", outputKind = "image" } = {}) {
  const seen = { uploads: [], prompts: [], interrupts: [], deletes: [], ws: 0 }
  const clients = new Map()
  const history = {}
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x")
    if (req.method === "GET" && url.pathname === "/system_stats") {
      return json(res, 200, { system: { comfyui_version: "0.41.0" }, devices: [{ name: "cuda:0 NVIDIA L40S : cudaMallocAsync", vram_total: 48 * 1024 ** 3 }] })
    }
    if (req.method === "GET" && url.pathname.startsWith("/models/")) {
      return json(res, 200, ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors"])
    }
    if (req.method === "POST" && url.pathname === "/upload/image") {
      const raw = (await body(req)).toString("latin1")
      const name = /filename="([^"]+)"/.exec(raw)?.[1]
      seen.uploads.push({ name, overwrite: raw.includes('name="overwrite"'), bytes: raw.length })
      return json(res, 200, { name, subfolder: "", type: "input" })
    }
    if (req.method === "POST" && url.pathname === "/prompt") {
      const data = JSON.parse((await body(req)).toString())
      seen.prompts.push(data)
      if (mode === "missing-model") {
        return json(res, 400, {
          error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
          node_errors: { 3: { class_type: "UNETLoader", errors: [{ type: "value_not_in_list", message: "Value not in list", details: "unet_name: 'z_image_turbo_bf16.safetensors' not in []" }] } },
        })
      }
      const id = data.prompt_id
      json(res, 200, { prompt_id: id, number: 1, node_errors: {} })
      run(id, data.client_id)
      return
    }
    if (req.method === "GET" && url.pathname.startsWith("/history/")) {
      const id = url.pathname.split("/").pop()
      return json(res, 200, history[id] ? { [id]: history[id] } : {})
    }
    if (req.method === "GET" && url.pathname === "/queue") return json(res, 200, { queue_running: [], queue_pending: [] })
    if (req.method === "POST" && url.pathname === "/interrupt") {
      seen.interrupts.push(JSON.parse((await body(req)).toString() || "{}"))
      res.writeHead(200)
      return res.end()
    }
    if (req.method === "POST" && url.pathname === "/queue") {
      seen.deletes.push(JSON.parse((await body(req)).toString()))
      res.writeHead(200)
      return res.end()
    }
    if (req.method === "GET" && url.pathname === "/view") {
      const name = url.searchParams.get("filename")
      if (name.endsWith(".mp4")) {
        res.writeHead(200, { "Content-Type": "video/mp4" })
        return res.end(Buffer.from("not really an mp4"))
      }
      res.writeHead(200, { "Content-Type": "image/png" })
      return res.end(proceduralImage({ width: 64, height: 64, seed: 3 }))
    }
    json(res, 404, { error: "not found" })
  })
  // Upgraded sockets leave the HTTP server's books, so close() must end them.
  const sockets = new Set()
  server.on("upgrade", (req, socket) => {
    const clientId = new URL(req.url, "http://x").searchParams.get("clientId")
    seen.ws++
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => {})
    // Answer the client's close frame (opcode 0x8) so it can finish cleanly.
    socket.on("data", (buf) => {
      if ((buf[0] & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0x00]))
    })
    clients.set(clientId, wsAccept(req, socket))
  })

  function run(id, clientId) {
    const ws = clients.get(clientId)
    const send = (type, data) => ws?.send({ type, data: { prompt_id: id, ...data } })
    const steps = mode === "slow" ? 400 : 4
    let i = 0
    send("execution_start", {})
    send("executing", { node: "4" })
    const timer = setInterval(() => {
      if (seen.interrupts.length) {
        clearInterval(timer)
        send("execution_interrupted", {})
        return
      }
      i++
      send("progress", { node: "4", value: i, max: steps })
      if (i < steps) return
      clearInterval(timer)
      if (mode === "exec-error") {
        send("execution_error", { node_type: "KSampler", exception_message: "CUDA out of memory" })
        history[id] = { outputs: {}, status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "KSampler", exception_message: "CUDA out of memory" }]] } }
        return
      }
      const file = outputKind === "video" ? { filename: "kino_00001_.mp4", subfolder: "video", type: "output" } : { filename: "ComfyUI_00001_.png", subfolder: "", type: "output" }
      history[id] = { outputs: { 9: { images: [file], ...(outputKind === "video" ? { animated: [true] } : {}) }, 10: { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] } }, status: { status_str: "success", completed: true, messages: [] } }
      send("executing", { node: null })
      send("execution_success", {})
    }, mode === "slow" ? 50 : 15)
  }

  const url = await listen(server)
  const close = () =>
    new Promise((r) => {
      for (const s of sockets) s.destroy()
      server.closeAllConnections?.()
      server.close(r)
    })
  return { url, seen, close }
}

/** RunPod Serverless: /run, /status, /cancel, /health. */
export async function fakeRunpod({ mode = "ok", key = "rpa_test" } = {}) {
  const seen = { runs: [], cancels: [], auth: [] }
  const jobs = {}
  const server = createServer(async (req, res) => {
    seen.auth.push(req.headers.authorization)
    if (req.headers.authorization !== `Bearer ${key}`) return json(res, 401, { error: "Unauthorized" })
    const parts = new URL(req.url, "http://x").pathname.split("/").filter(Boolean) // v2/<endpoint>/<op>/<id>
    const [, , op, id] = parts
    if (req.method === "GET" && op === "health") return json(res, 200, { jobs: { completed: 3, inQueue: 0 }, workers: { idle: 1, running: 0 } })
    if (req.method === "POST" && op === "run") {
      const data = JSON.parse((await body(req)).toString())
      const jobId = `job-${seen.runs.length + 1}`
      seen.runs.push(data)
      jobs[jobId] = { polls: 0 }
      return json(res, 200, { id: jobId, status: "IN_QUEUE" })
    }
    if (req.method === "GET" && op === "status") {
      const job = jobs[id]
      job.polls++
      if (job.cancelled) return json(res, 200, { id, status: "CANCELLED" })
      if (job.polls === 1) return json(res, 200, { id, status: "IN_QUEUE" })
      if (job.polls === 2 || mode === "slow") return json(res, 200, { id, status: "IN_PROGRESS" })
      if (mode === "fail") {
        return json(res, 200, {
          id,
          status: "FAILED",
          error:
            "Workflow references model files that are not available on this worker:\n• Node 3 (UNETLoader.unet_name): 'z_image_turbo_bf16.safetensors' not found in diffusion_models. Expected at /runpod-volume/models/diffusion_models/z_image_turbo_bf16.safetensors",
        })
      }
      if (mode === "crash") return json(res, 200, { id, status: "FAILED", error: JSON.stringify({ error_type: "RuntimeError", error_message: "CUDA error: out of memory" }) })
      const png = proceduralImage({ width: 32, height: 32, seed: 1 }).toString("base64")
      return json(res, 200, { id, status: "COMPLETED", output: { images: [{ filename: "ComfyUI_00001_.png", type: "base64", data: png }] } })
    }
    if (req.method === "POST" && op === "cancel") {
      seen.cancels.push(id)
      if (jobs[id]) jobs[id].cancelled = true
      return json(res, 200, { id, status: "CANCELLED" })
    }
    json(res, 404, { error: "not found" })
  })
  const url = await listen(server)
  return { base: `${url}/v2`, seen, close: () => new Promise((r) => (server.closeAllConnections?.(), server.close(r))) }
}
