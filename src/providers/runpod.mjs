// RunPod Serverless running runpod/worker-comfyui (see runpod/). Pay per second
// of GPU, scale to zero when idle. The worker takes the same API-format prompt a
// ComfyUI server does, with input files inlined as base64:
//   POST /v2/<endpoint>/run      {input: {workflow, images: [{name, image}]}}
//   GET  /v2/<endpoint>/status/<id>
//   POST /v2/<endpoint>/cancel/<id>
//   GET  /v2/<endpoint>/health
// and returns {images: [{filename, type: "base64" | "s3_url", data}]}; videos come
// back in the same list.

import { readFile } from "node:fs/promises"
import { CanceledError, mimeFor, readJson, request, sleep } from "./common.mjs"

// /run accepts 10 MB of JSON; base64 inflates files by a third.
const MAX_PAYLOAD = 10 * 1024 * 1024 - 64 * 1024

export class RunpodProvider {
  constructor({ endpoint, key, base = process.env.RUNPOD_API_BASE ?? "https://api.runpod.ai/v2", pollMs = 2500 }) {
    if (!endpoint || !key) throw new Error("Add your RunPod endpoint ID and API key in Settings.")
    this.endpoint = endpoint.trim()
    this.key = key.trim()
    this.base = `${base.replace(/\/+$/, "")}/${encodeURIComponent(this.endpoint)}`
    this.pollMs = pollMs
    this.id = "runpod"
    this.label = `RunPod endpoint ${this.endpoint.slice(0, 6)}…`
  }

  async call(path, { method = "GET", body, signal, timeoutMs = 60_000 } = {}) {
    const res = await request(`${this.base}${path}`, {
      method,
      signal,
      timeoutMs,
      headers: { Authorization: `Bearer ${this.key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    })
    const data = await readJson(res)
    if (res.status === 401 || res.status === 403) throw new Error("RunPod rejected the API key. Check it in Settings.")
    if (res.status === 404) throw new Error("RunPod doesn't know that endpoint ID. Check it in Settings.")
    if (!res.ok) throw new Error(`RunPod answered ${res.status}: ${data.error ?? data.raw ?? ""}`.trim())
    return data
  }

  async status() {
    const h = await this.call("/health", { timeoutMs: 15_000 })
    const w = h.workers ?? {}
    const ready = (w.idle ?? 0) + (w.ready ?? 0)
    const parts = [`${ready} worker${ready === 1 ? "" : "s"} warm`]
    if (w.running) parts.push(`${w.running} busy`)
    if (w.initializing) parts.push(`${w.initializing} starting`)
    if (w.throttled) parts.push(`${w.throttled} throttled`)
    if (w.unhealthy) parts.push(`${w.unhealthy} unhealthy`)
    return { ok: true, label: `RunPod Serverless · ${parts.join(", ")}`, workers: w, jobs: h.jobs ?? {}, apps: {} }
  }

  async run({ prompt, files = [], onProgress = () => {}, signal, expectedSeconds = 60 }) {
    const images = []
    for (const f of files) images.push({ name: f.name, image: (f.data ?? (await readFile(f.path))).toString("base64") })
    const body = JSON.stringify({ input: images.length ? { workflow: prompt, images } : { workflow: prompt } })
    if (body.length > MAX_PAYLOAD) {
      throw new Error(`Inputs are too large for RunPod Serverless (${(body.length / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB). Use a shorter or smaller video, or a GPU pod via the ComfyUI option.`)
    }

    onProgress(0.01, "Sending to RunPod")
    const job = await this.call("/run", { method: "POST", body, signal, timeoutMs: 120_000 })
    if (!job.id) throw new Error("RunPod didn't return a job id.")
    const cancel = () => this.call(`/cancel/${job.id}`, { method: "POST" }).catch(() => {})
    signal?.addEventListener("abort", cancel, { once: true })

    try {
      const submitted = Date.now()
      let runningSince = null
      while (true) {
        await sleep(runningSince ? this.pollMs : Math.min(this.pollMs, 1500), signal)
        const s = await this.call(`/status/${job.id}`, { signal, timeoutMs: 30_000 }).catch((e) => {
          if (e.canceled) throw e
          return { status: "UNKNOWN", transient: e.message }
        })
        switch (s.status) {
          case "IN_QUEUE": {
            const waited = (Date.now() - submitted) / 1000
            onProgress(0.02, waited > 20 ? "Starting a GPU worker (cold starts take 1–3 min)" : "Waiting for a GPU worker")
            break
          }
          case "IN_PROGRESS": {
            runningSince ??= Date.now()
            const t = (Date.now() - runningSince) / 1000
            // No step events through serverless, so estimate along an easing curve
            // that slows down rather than stalls when a run takes longer than usual.
            const p = 1 - Math.exp(-t / Math.max(5, expectedSeconds * 0.6))
            onProgress(0.05 + p * 0.88, typeof s.output === "string" ? s.output : "Generating")
            break
          }
          case "COMPLETED":
            onProgress(0.96, "Downloading results")
            return await this.collect(s.output, signal)
          case "FAILED":
            throw new Error(describeFailure(s))
          case "CANCELLED":
            throw new CanceledError()
          case "TIMED_OUT":
            throw new Error("RunPod stopped the job at the endpoint's execution timeout. Raise it in the endpoint settings.")
          default:
            break // UNKNOWN / transient: keep polling
        }
        if (Date.now() - submitted > Math.max(30 * 60_000, expectedSeconds * 1000 * 15)) {
          cancel()
          throw new Error("RunPod hasn't finished after a long time, so Kino canceled the job.")
        }
      }
    } finally {
      signal?.removeEventListener("abort", cancel)
    }
  }

  async collect(output, signal) {
    if (output?.error) throw new Error(describeFailure({ output }))
    const list = output?.images ?? []
    if (!list.length) throw new Error("The workflow finished on RunPod but produced no files.")
    const out = []
    for (const item of list) {
      if (item.type === "s3_url") {
        const res = await request(item.data, { signal, timeoutMs: 10 * 60_000 })
        if (!res.ok) throw new Error(`Couldn't download ${item.filename} from the bucket (${res.status}).`)
        out.push({ data: Buffer.from(await res.arrayBuffer()), filename: item.filename, mime: mimeFor(item.filename) })
      } else {
        out.push({ data: Buffer.from(item.data, "base64"), filename: item.filename, mime: mimeFor(item.filename) })
      }
    }
    return out
  }
}

function describeFailure(s) {
  const raw = s.error ?? s.output?.error ?? "The job failed on RunPod."
  let message = raw
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      message = parsed.error_message ?? parsed.error ?? raw
    } catch {}
  } else if (typeof raw === "object") {
    message = raw.error_message ?? raw.message ?? JSON.stringify(raw)
  }
  const details = s.output?.details ?? s.details
  const text = [String(message), ...(Array.isArray(details) ? details : details ? [details] : [])].join("\n")
  // worker-comfyui's pre-flight: "'x.safetensors' not found in diffusion_models. Expected at /runpod-volume/models/…"
  if (/not in list|not found in|Expected at \/runpod-volume|missing model/i.test(text)) return `${text}\nA model file is missing on the network volume. Run runpod/download-models.sh on a pod attached to it.`
  return text
}
