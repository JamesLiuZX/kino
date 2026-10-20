// A stand-in for stable-diffusion.cpp's sd-server, faithful to the parts of its
// native API (/sdcpp/v1) Kino uses: capabilities, async img_gen and vid_gen
// jobs that report steps through previews, polling and cancel. Started the way
// Kino starts the real one: `sd-server <model flags> --listen-ip 127.0.0.1 --listen-port N`.
//
//   FAKE_SD_LOG=<file>      append every request (and the command line) as JSON lines
//   FAKE_SD_LOAD_MS=<ms>    pretend to load models for this long before listening
//   FAKE_SD_STEP_MS=<ms>    time per sampling step (default 30)
//   FAKE_SD_MODE=ok|fail|crash   fail jobs, or exit while "loading"
//
// Also acts as sd-cli for `-M upscale -i in -o out`: copies the input, 4x the
// size via ffmpeg when it's there.

import { createServer } from "node:http"
import { appendFileSync, copyFileSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { proceduralImage } from "../../src/media/png.mjs"

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const log = (entry) => process.env.FAKE_SD_LOG && appendFileSync(process.env.FAKE_SD_LOG, JSON.stringify(entry) + "\n")
const mode = process.env.FAKE_SD_MODE ?? "ok"
const stepMs = Number(process.env.FAKE_SD_STEP_MS ?? 30)

if (arg("-M") === "upscale") {
  log({ cli: args })
  const input = arg("-i")
  const output = arg("-o")
  const scaled = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", "scale=iw*4:ih*4", output])
  if (scaled.status !== 0) copyFileSync(input, output)
  process.exit(0)
}

log({ argv: args })
const jobs = new Map()
let next = 1

const json = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

async function body(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}
}

function webm() {
  const out = `${process.env.FAKE_SD_LOG ?? "/tmp/fake-sd"}.${next}.webm`
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=teal:s=64x64:d=1:r=24", "-c:v", "libvpx-vp9", "-b:v", "50k", out])
  if (r.status !== 0) return Buffer.from("not really a webm")
  return readFileSync(out)
}

function start(kind, request) {
  const id = `job_${next++}`
  const total = request.sample_params?.sample_steps ?? 8
  const job = { id, kind, status: "queued", created: Math.floor(Date.now() / 1000), request, step: 0, total, cancelled: false }
  jobs.set(id, job)
  setTimeout(() => {
    if (job.cancelled) return
    job.status = "generating"
    const tick = setInterval(() => {
      if (job.cancelled) return clearInterval(tick)
      job.step++
      if (job.step < total) return
      clearInterval(tick)
      if (mode === "fail") {
        job.status = "failed"
        job.error = { code: "generation_failed", message: "generate_image returned empty results" }
        return
      }
      job.status = "completed"
      if (kind === "img_gen") {
        const png = proceduralImage({ width: Math.min(request.width ?? 64, 256), height: Math.min(request.height ?? 64, 256), seed: request.seed ?? 1, prompt: request.prompt ?? "" })
        job.result = { output_format: "png", images: [{ index: 0, b64_json: png.toString("base64") }] }
      } else {
        job.result = { output_format: "webm", mime_type: "video/webm", fps: request.fps ?? 24, frame_count: request.video_frames ?? 33, b64_json: webm().toString("base64") }
      }
    }, stepMs)
  }, 20)
  return job
}

const view = (job) => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  created: job.created,
  queue_position: 0,
  result: job.result ?? null,
  error: job.error ?? (job.status === "cancelled" ? { code: "cancelled", message: "job cancelled by client" } : null),
  ...(job.status === "generating" && job.request.preview && job.request.preview !== "none" && job.step > 0
    ? { preview: { pass: 1, step: job.step, total_steps: job.total, b64_json: "iVBORw0KGgo=" } }
    : {}),
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x")
  const path = url.pathname
  if (req.method === "GET" && path === "/sdcpp/v1/capabilities") return json(res, 200, { model: { name: arg("--diffusion-model") ?? "fake" }, supported_modes: ["img_gen", "vid_gen"] })
  if (req.method === "POST" && (path === "/sdcpp/v1/img_gen" || path === "/sdcpp/v1/vid_gen")) {
    const request = await body(req)
    log({ path, request })
    const job = start(path.endsWith("img_gen") ? "img_gen" : "vid_gen", request)
    return json(res, 202, { id: job.id, kind: job.kind, status: "queued", created: job.created, poll_url: `/sdcpp/v1/jobs/${job.id}` })
  }
  const m = /^\/sdcpp\/v1\/jobs\/([^/]+)(\/cancel)?$/.exec(path)
  if (m) {
    const job = jobs.get(m[1])
    if (!job) return json(res, 404, { error: "not found" })
    if (m[2] && req.method === "POST") {
      log({ path })
      job.cancelled = true
      job.status = "cancelled"
      return json(res, 200, view(job))
    }
    return json(res, 200, view(job))
  }
  json(res, 404, { error: "no route" })
})

if (mode === "crash") {
  console.error("ggml_metal_init: error: failed to allocate buffer, out of memory")
  setTimeout(() => process.exit(3), 50)
} else {
  setTimeout(() => server.listen(Number(arg("--listen-port")), arg("--listen-ip") ?? "127.0.0.1"), Number(process.env.FAKE_SD_LOAD_MS ?? 0))
}
process.on("SIGTERM", () => {
  log({ signal: "SIGTERM" })
  process.exit(0)
})
