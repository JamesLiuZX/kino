// A ComfyUI server reached over HTTP: a RunPod GPU pod (https://<pod>-8188.proxy.runpod.net),
// a machine on the LAN, or localhost. Uses ComfyUI's own API end to end:
//   POST /upload/image   inputs (images, audio and video all go through it)
//   POST /prompt         with our own prompt_id, so we can listen before queueing
//   WS   /ws             live progress; /history polling covers a dropped socket
//   GET  /history, /view results
//   POST /queue, /interrupt  cancel

import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { CanceledError, explainComfyError, mimeFor, nodeWeight, readJson, request, sleep } from "./common.mjs"

const OUTPUT_KEYS = ["images", "gifs", "videos", "video", "audio"]

export class ComfyProvider {
  constructor({ url, token = "", pollMs = 2000 }) {
    if (!url) throw new Error("Add your ComfyUI server address in Settings.")
    this.url = url.replace(/\/+$/, "")
    this.token = token
    this.pollMs = pollMs
    this.id = "comfy"
    this.label = `ComfyUI at ${new URL(this.url).host}`
  }

  headers(extra = {}) {
    return this.token ? { Authorization: `Bearer ${this.token}`, ...extra } : extra
  }

  async json(path, init = {}) {
    const res = await request(`${this.url}${path}`, { ...init, headers: this.headers(init.headers) })
    const body = await readJson(res)
    if (!res.ok) {
      const e = new Error(res.status === 400 ? explainComfyError(body) : `ComfyUI answered ${res.status} for ${path}`)
      e.status = res.status
      e.body = body
      throw e
    }
    return body
  }

  async status(modelsByApp = {}) {
    const stats = await this.json("/system_stats", { timeoutMs: 10_000 })
    const device = stats.devices?.[0]
    const gb = device?.vram_total ? Math.round(device.vram_total / 1024 ** 3) : null
    const version = stats.system?.comfyui_version ?? "?"
    const listings = {}
    const apps = {}
    for (const [appId, models] of Object.entries(modelsByApp)) {
      const missing = []
      for (const m of models) {
        if (!m.directory) continue
        listings[m.directory] ??= await this.json(`/models/${encodeURIComponent(m.directory)}`, { timeoutMs: 15_000 }).catch(() => null)
        const have = listings[m.directory]
        if (have && !have.includes(m.name)) missing.push(m)
      }
      apps[appId] = { ready: missing.length === 0, missing }
    }
    return {
      ok: true,
      label: `ComfyUI ${version}${device ? ` on ${device.name.replace(/^cuda:\d+\s*/, "").replace(/\s*:.*$/, "")}${gb ? ` (${gb} GB)` : ""}` : ""}`,
      version,
      gpu: device?.name ?? null,
      vramGb: gb,
      apps,
    }
  }

  objectInfo() {
    return this.json("/object_info", { timeoutMs: 60_000 })
  }

  async upload(file, signal) {
    const form = new FormData()
    const data = file.data ?? (await readFile(file.path))
    form.append("image", new Blob([data], { type: file.mime ?? mimeFor(file.name) }), file.name)
    form.append("overwrite", "true")
    form.append("type", "input")
    const res = await request(`${this.url}/upload/image`, { method: "POST", body: form, headers: this.headers(), signal, timeoutMs: 5 * 60_000 })
    if (!res.ok) throw new Error(`Uploading ${file.name} to ComfyUI failed (${res.status}).`)
    const body = await res.json()
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name
  }

  /**
   * Runs one prompt. `files` are uploaded first; their names must already be in
   * the prompt (the job runner binds them). Resolves to [{data, filename, mime}].
   */
  async run({ prompt, files = [], onProgress = () => {}, signal, expectedSeconds = 60 }) {
    onProgress(0.01, files.length ? "Uploading inputs" : "Sending to ComfyUI")
    for (const f of files) {
      const stored = await this.upload(f, signal)
      if (stored !== f.name) renameInputs(prompt, f.name, stored)
    }

    const promptId = randomUUID()
    const clientId = randomUUID()
    const tracker = new Tracker(prompt, onProgress)
    const socket = this.listen(clientId, promptId, tracker)
    let finished = false
    const onAbort = () => {
      if (finished) return
      this.json("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) }).catch(() => {})
      this.json("/interrupt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: promptId }) }).catch(() => {})
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    try {
      await this.json("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, client_id: clientId, prompt_id: promptId }),
        signal,
      })
      tracker.queued()
      const entry = await this.waitForHistory(promptId, tracker, signal, expectedSeconds)
      finished = true
      onProgress(0.97, "Downloading results")
      return await this.collect(entry, signal)
    } finally {
      finished = true
      signal?.removeEventListener("abort", onAbort)
      socket?.close()
    }
  }

  listen(clientId, promptId, tracker) {
    if (typeof WebSocket !== "function") return null
    const wsUrl = `${this.url.replace(/^http/, "ws")}/ws?clientId=${clientId}`
    let ws
    try {
      ws = new WebSocket(wsUrl, this.token ? { headers: this.headers() } : undefined)
    } catch {
      return null
    }
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return // binary preview frames
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      const data = msg.data ?? {}
      if (msg.type === "status") tracker.queueRemaining(data.status?.exec_info?.queue_remaining)
      if (data.prompt_id && data.prompt_id !== promptId) return
      tracker.event(msg.type, data)
    })
    ws.addEventListener("error", () => {})
    return ws
  }

  /** Poll /history until the prompt is there; the socket only makes it faster. */
  async waitForHistory(promptId, tracker, signal, expectedSeconds) {
    const started = Date.now()
    const limit = Math.max(20 * 60_000, expectedSeconds * 1000 * 10)
    let delay = 600
    while (true) {
      if (signal?.aborted) throw new CanceledError()
      if (tracker.error) throw new Error(tracker.error)
      if (tracker.interrupted) throw new CanceledError()
      const history = await this.json(`/history/${promptId}`, { timeoutMs: 30_000, signal }).catch((e) => {
        if (e.canceled) throw e
        return null
      })
      const entry = history?.[promptId]
      if (entry) {
        const status = entry.status ?? {}
        if (status.status_str === "error") throw new Error(historyError(status) ?? "The workflow failed on the GPU server.")
        if (status.completed !== false) return entry
      } else if (!tracker.started) {
        const queue = await this.json("/queue", { timeoutMs: 15_000, signal }).catch(() => null)
        if (queue) {
          const ahead = (queue.queue_running?.length ?? 0) + (queue.queue_pending ?? []).findIndex((q) => q[1] === promptId)
          const inPending = (queue.queue_pending ?? []).some((q) => q[1] === promptId)
          const running = (queue.queue_running ?? []).some((q) => q[1] === promptId)
          if (inPending) tracker.waiting(ahead)
          else if (running) tracker.running()
        }
      }
      if (Date.now() - started > limit) throw new Error("The GPU server hasn't finished after a long time; check it in ComfyUI.")
      await tracker.wait(Math.min(delay, this.pollMs), signal)
      delay = Math.min(this.pollMs, delay * 1.5)
    }
  }

  async collect(entry, signal) {
    const items = []
    for (const nodeOutput of Object.values(entry.outputs ?? {})) {
      for (const key of OUTPUT_KEYS) for (const item of nodeOutput[key] ?? []) if (item?.filename) items.push(item)
    }
    const saved = items.filter((i) => i.type === "output")
    const chosen = saved.length ? saved : items
    if (!chosen.length) throw new Error("The workflow finished but produced no files.")
    const out = []
    for (const item of chosen) {
      const q = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? "", type: item.type ?? "output" })
      const res = await request(`${this.url}/view?${q}`, { headers: this.headers(), signal, timeoutMs: 10 * 60_000 })
      if (!res.ok) throw new Error(`Couldn't download ${item.filename} from ComfyUI (${res.status}).`)
      out.push({ data: Buffer.from(await res.arrayBuffer()), filename: item.filename, mime: mimeFor(item.filename) })
    }
    return out
  }
}

function renameInputs(prompt, from, to) {
  for (const node of Object.values(prompt)) for (const [k, v] of Object.entries(node.inputs)) if (v === from) node.inputs[k] = to
}

function historyError(status) {
  for (const [type, data] of status.messages ?? []) {
    if (type === "execution_error") return `${data.node_type ?? "A node"} failed: ${String(data.exception_message ?? "").trim()}`
  }
  return null
}

/** Turns ComfyUI's event stream into one 0..1 number and a short status line. */
class Tracker {
  constructor(prompt, onProgress) {
    this.prompt = prompt
    this.onProgress = onProgress
    this.total = Object.values(prompt).reduce((s, n) => s + nodeWeight(n.class_type), 0) || 1
    this.done = new Set()
    this.current = null
    this.fraction = 0
    this.started = false
    this.error = null
    this.interrupted = false
    this.wake = null
  }

  report(message) {
    let w = 0
    for (const id of this.done) w += nodeWeight(this.prompt[id]?.class_type ?? "")
    if (this.current && !this.done.has(this.current)) w += nodeWeight(this.prompt[this.current]?.class_type ?? "") * this.fraction
    this.onProgress(Math.min(0.96, 0.03 + (w / this.total) * 0.93), message)
  }

  queued() {
    this.onProgress(0.02, "Queued on the GPU server")
  }

  queueRemaining(n) {
    if (!this.started && Number.isInteger(n) && n > 1) this.onProgress(0.02, `In the GPU queue (${n - 1} ahead)`)
  }

  waiting(ahead) {
    if (!this.started) this.onProgress(0.02, ahead > 0 ? `In the GPU queue (${ahead} ahead)` : "Starting")
  }

  running() {
    if (!this.started) {
      this.started = true
      this.report("Running")
    }
  }

  event(type, data) {
    switch (type) {
      case "execution_start":
        this.started = true
        this.report("Starting")
        break
      case "execution_cached":
        for (const id of data.nodes ?? []) this.done.add(String(id))
        this.report("Starting")
        break
      case "executing":
        if (data.node == null) {
          this.poke()
          break
        }
        if (this.current) this.done.add(this.current)
        this.current = String(data.node)
        this.fraction = 0
        this.started = true
        this.report(labelFor(this.prompt[this.current]))
        break
      case "progress":
        if (data.node != null && String(data.node) !== this.current) {
          if (this.current) this.done.add(this.current)
          this.current = String(data.node)
        }
        this.fraction = data.max ? data.value / data.max : 0
        this.report(`${labelFor(this.prompt[this.current])} ${data.value}/${data.max}`)
        break
      case "progress_state": {
        const running = Object.entries(data.nodes ?? {}).find(([, s]) => s.state === "running")
        for (const [id, s] of Object.entries(data.nodes ?? {})) if (s.state === "finished") this.done.add(String(s.real_node_id ?? id))
        if (running) {
          const [id, s] = running
          this.current = String(s.real_node_id ?? id)
          this.fraction = s.max ? s.value / s.max : 0
          this.report(s.max > 1 ? `${labelFor(this.prompt[this.current])} ${s.value}/${s.max}` : labelFor(this.prompt[this.current]))
        }
        break
      }
      case "executed":
        if (data.node != null) this.done.add(String(data.node))
        break
      case "execution_success":
        this.poke()
        break
      case "execution_error":
        this.error = `${data.node_type ?? "A node"} failed: ${String(data.exception_message ?? "unknown error").trim()}`
        this.poke()
        break
      case "execution_interrupted":
        this.interrupted = true
        this.poke()
        break
    }
  }

  /** Lets the poll loop check /history right away when the socket says we're done. */
  poke() {
    this.wake?.()
  }

  wait(ms, signal) {
    return Promise.race([sleep(ms, signal), new Promise((r) => (this.wake = r))])
  }
}

function labelFor(node) {
  const c = node?.class_type ?? ""
  if (/Loader|Load(Checkpoint|Diffusion|CLIP|VAE|Lora)/i.test(c)) return "Loading models"
  if (/TextEncode|Encode.*Text|TextGenerate/i.test(c)) return "Reading your prompt"
  if (/Sampler|KSampler/i.test(c)) return "Generating"
  if (/Decode/i.test(c)) return "Decoding"
  if (/Upscale|SeedVR/i.test(c)) return "Upscaling"
  if (/Interpolat/i.test(c)) return "Interpolating frames"
  if (/Save/i.test(c)) return "Saving"
  return "Working"
}
