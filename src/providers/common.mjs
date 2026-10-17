// Shared bits for providers: file types, friendly errors, small async helpers.

import { extname } from "node:path"

export const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".opus": "audio/opus",
}

export const mimeFor = (name) => MIME[extname(String(name)).toLowerCase()] ?? "application/octet-stream"
export const kindFor = (mime) => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file")

export class CanceledError extends Error {
  constructor() {
    super("Canceled")
    this.canceled = true
  }
}

export const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CanceledError())
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new CanceledError())
      },
      { once: true },
    )
  })

/** fetch with a timeout that also honours the job's abort signal. */
export async function request(url, { timeoutMs = 60_000, signal, ...init } = {}) {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (signal) signals.push(signal)
  try {
    return await fetch(url, { ...init, signal: AbortSignal.any(signals) })
  } catch (e) {
    if (signal?.aborted) throw new CanceledError()
    if (e.name === "TimeoutError") throw new Error(`${new URL(url).host} took too long to answer.`)
    throw new Error(`Couldn't reach ${new URL(url).host} (${e.cause?.code ?? e.message}).`)
  }
}

export async function readJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 500) }
  }
}

/**
 * ComfyUI's /prompt rejections, rewritten for people. The usual cause by far is
 * a model file that isn't on the server yet.
 */
export function explainComfyError(body) {
  const lines = []
  const err = body?.error
  if (err?.type === "missing_node_type" || /not found/i.test(err?.message ?? "")) lines.push(`${err.message} Install the custom node on your ComfyUI server.`)
  for (const [id, ne] of Object.entries(body?.node_errors ?? {})) {
    for (const e of ne.errors ?? []) {
      const m = /^(\w+): '([^']+)' not in/.exec(e.details ?? "")
      if (e.type === "value_not_in_list" && m && /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(m[2])) {
        lines.push(`Model file missing on the GPU server: ${m[2]} (node ${id}, ${ne.class_type}). Run runpod/download-models.sh to fetch it.`)
      } else if (e.type === "value_not_in_list" && m) {
        lines.push(`Input file missing on the server: ${m[2]} (node ${id}).`)
      } else {
        lines.push(`${ne.class_type} (node ${id}): ${e.message}${e.details ? ` — ${e.details}` : ""}`)
      }
    }
  }
  if (!lines.length && err) lines.push(err.message ?? JSON.stringify(err))
  return [...new Set(lines)].join("\n") || "ComfyUI rejected the workflow."
}

/**
 * Overall progress from per-node states. Samplers dominate run time, so they
 * weigh more than loaders and glue nodes.
 */
export function nodeWeight(classType) {
  if (/Sampler|KSampler|SamplerCustom/i.test(classType)) return 12
  if (/Decode|Upscale|SeedVR|Interpolat|VideoCombine|SaveVideo/i.test(classType)) return 3
  return 1
}
