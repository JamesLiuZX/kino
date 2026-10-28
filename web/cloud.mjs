// Kino on the web, for real: the generative apps run on fal.ai with the
// visitor's own key. The key stays in this browser and goes only to fal;
// photos go as data URIs, and results come back as files on fal's CDN, which
// the page fetches into its library. Each app maps to one of fal's endpoints:
// the same open models the desktop studio runs wherever fal has them.
// scripts/check-cloud.mjs checks the mapping against fal's published schemas
// every week.
//
// No imports, so the check (Node) and the page share this file; the page hands
// in the prompt builders and the files (`h`).

const QUEUE = "https://queue.fal.run"
const KEY = "kino:fal-key"

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
/** The smallest allowed value at or above n, else the largest. */
const atLeast = (n, allowed) => allowed.find((x) => x >= n) ?? allowed[allowed.length - 1]
const LTX_SECONDS = [6, 8, 10, 12, 14, 16, 18, 20]
const WAN_ASPECTS = ["16:9", "9:16", "1:1"]

/** LTX-2 reads plain sentences: what happens, the camera, the look, then the sound. */
const ltxPrompt = (v, h) => [h.wanPrompt({ prompt: v.prompt || "The scene comes gently to life", camera: v.camera, style: v.style }), h.audioPhrase(v.audio) ? `Sound: ${h.audioPhrase(v.audio)}.` : ""].filter(Boolean).join(" ")

/**
 * app id -> { model, endpoint(values), input(values, h) }. `h` has imagePrompt,
 * wanPrompt, talkingPrompt, audioPhrase(id), size(aspect, megapixels) and
 * file(assetId) -> a data URI.
 */
export const ENDPOINTS = {
  "image-fast": {
    model: "Z-Image Turbo · fal.ai",
    endpoint: () => "fal-ai/z-image/turbo",
    input: (v, h) => ({ prompt: h.imagePrompt(v.prompt, v.style), image_size: h.size(v.aspect, 1), num_inference_steps: v.detail === "high" ? 12 : 8, seed: v.seed, output_format: "png" }),
  },
  "image-pro": {
    model: "Qwen Image · fal.ai",
    endpoint: () => "fal-ai/qwen-image-2512",
    input: (v, h) => ({ prompt: h.imagePrompt(v.prompt, v.style), image_size: h.size(v.aspect, v.resolution === "2mp" ? 2 : 1), seed: v.seed, output_format: "png" }),
  },
  edit: {
    model: "Qwen Image Edit · fal.ai",
    endpoint: () => "fal-ai/qwen-image-edit-2511",
    input: async (v, h) => ({ prompt: v.prompt, image_urls: [await h.file(v.image), ...(v.image2 ? [await h.file(v.image2)] : [])], seed: v.seed, output_format: "png" }),
  },
  cutout: {
    model: "BiRefNet · fal.ai",
    endpoint: () => "fal-ai/birefnet/v2",
    input: async (v, h) => ({ image_url: await h.file(v.image), model: "General Use (Heavy)", output_format: "png" }),
  },
  "upscale-image": {
    model: "SeedVR2 · fal.ai",
    endpoint: () => "fal-ai/seedvr/upscale/image",
    input: async (v, h) => ({ image_url: await h.file(v.image), upscale_factor: v.scale === "4x" ? 4 : 2, output_format: "png" }),
  },
  "video-pro": {
    model: "LTX-2 Fast, with sound · fal.ai",
    sound: true,
    endpoint: () => "fal-ai/ltx-2/image-to-video/fast",
    input: async (v, h) => ({ prompt: ltxPrompt(v, h), image_url: await h.file(v.image), duration: atLeast(v.duration ?? 6, LTX_SECONDS), generate_audio: true }),
  },
  "video-scene": {
    model: "LTX-2 Fast, with sound · fal.ai",
    sound: true,
    endpoint: () => "fal-ai/ltx-2/text-to-video/fast",
    input: (v, h) => ({ prompt: ltxPrompt(v, h), duration: atLeast(v.duration ?? 6, LTX_SECONDS), generate_audio: true }),
  },
  "video-draft": {
    model: "Wan 2.2 5B · fal.ai",
    endpoint: (v) => (v.image ? "fal-ai/wan/v2.2-5b/image-to-video" : "fal-ai/wan/v2.2-5b/text-to-video"),
    input: async (v, h) => ({
      prompt: h.wanPrompt({ prompt: v.prompt, camera: v.camera, style: v.style }),
      ...(v.image ? { image_url: await h.file(v.image) } : {}),
      aspect_ratio: WAN_ASPECTS.includes(v.aspect) ? v.aspect : "16:9",
      num_frames: clamp(Math.round(((v.duration ?? 5) * 24) / 4) * 4 + 1, 17, 161),
      seed: v.seed,
    }),
  },
  talk: {
    model: "InfiniteTalk · fal.ai",
    sound: true,
    endpoint: () => "fal-ai/infinitalk",
    input: async (v, h) => ({
      image_url: await h.file(v.image),
      audio_url: await h.file(v.audio),
      prompt: h.talkingPrompt({ prompt: v.prompt }),
      num_frames: clamp(Math.round((v.duration ?? 6) * 25) + 1, 41, 721),
      resolution: "720p",
      seed: v.seed,
    }),
  },
  "upscale-video": {
    model: "SeedVR2 · fal.ai",
    endpoint: () => "fal-ai/seedvr/upscale/video",
    input: async (v, h) => ({ video_url: await h.file(v.video), upscale_factor: v.scale === "3x" ? 3 : 2 }),
  },
  smooth: {
    model: "FILM · fal.ai",
    endpoint: () => "fal-ai/film/video",
    input: async (v, h) => ({ video_url: await h.file(v.video), num_frames: v.factor === "4x" ? 3 : 1, use_calculated_fps: true }),
  },
}

// ---------------------------------------------------------------- the key

export function cloudKey() {
  try {
    return localStorage.getItem(KEY) || ""
  } catch {
    return ""
  }
}

export function setCloudKey(key) {
  try {
    if (key) localStorage.setItem(KEY, String(key).trim())
    else localStorage.removeItem(KEY)
  } catch {}
}

// ---------------------------------------------------------------- the queue

const canceled = () => Object.assign(new Error("Canceled"), { canceled: true })

const sleep = (ms, signal) =>
  new Promise((ok, no) => {
    if (signal?.aborted) return no(canceled())
    const t = setTimeout(ok, ms)
    signal?.addEventListener("abort", () => (clearTimeout(t), no(canceled())), { once: true })
  })

const detail = (body) =>
  typeof body?.detail === "string" ? body.detail : Array.isArray(body?.detail) ? body.detail.map((d) => d?.msg ?? JSON.stringify(d)).join("; ") : (body?.error ?? body?.message ?? "")

/** fal's answer as a sentence a person can act on. */
export function falError(status, body) {
  const why = detail(body)
  if (status === 401) return "fal.ai didn't accept the key. Check it in Settings."
  if (status === 403) return `fal.ai refused it${why ? `: ${why}` : ". Check your fal.ai account's balance."}`
  if (status === 422) return `fal.ai couldn't use those settings${why ? `: ${why}` : "."}`
  if (status === 429) return "fal.ai is busy for this account right now; try again in a minute."
  return `fal.ai answered ${status}${why ? `: ${why}` : ""}.`
}

/** The files in a result: images[], image or video, with what fal says about them. */
export function filesIn(result) {
  const out = []
  for (const key of ["images", "image", "video"]) {
    const v = result?.[key]
    for (const f of Array.isArray(v) ? v : v ? [v] : []) if (f?.url) out.push({ url: f.url, mime: f.content_type ?? null, width: f.width ?? null, height: f.height ?? null })
  }
  return out
}

/**
 * Run one job on fal: submit it, follow the queue, return the result's files.
 * onProgress(message) while it waits; cancelling the signal cancels it on fal.
 */
export async function runOnFal({ appId, values, key, h, signal, onProgress = () => {}, fetch: get = fetch, pollMs = 700 }) {
  const app = ENDPOINTS[appId]
  if (!app) throw new Error(`${appId} doesn't run on fal.ai.`)
  if (!key) throw new Error("Add your fal.ai key in Settings first.")
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" }
  const call = async (url, init = {}) => {
    let res
    try {
      res = await get(url, { ...init, headers, signal })
    } catch (e) {
      if (signal?.aborted) throw canceled()
      throw new Error(`Couldn't reach fal.ai (${e.message}). Check your connection.`)
    }
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {}
    if (!res.ok) throw new Error(falError(res.status, body))
    return body
  }
  const input = Object.fromEntries(Object.entries(await app.input(values, h)).filter(([, v]) => v !== undefined && v !== null && v !== ""))
  onProgress("Sending to fal.ai")
  const job = await call(`${QUEUE}/${app.endpoint(values)}`, { method: "POST", body: JSON.stringify(input) })
  if (!job?.status_url || !job?.response_url) throw new Error("fal.ai didn't queue it.")
  const cancel = () => get(job.cancel_url, { method: "PUT", headers }).catch(() => {})
  signal?.addEventListener("abort", cancel, { once: true })
  try {
    for (let i = 0; ; i++) {
      const st = await call(job.status_url)
      if (st?.status === "COMPLETED") break
      onProgress(st?.status === "IN_QUEUE" ? `Waiting at fal.ai${st.queue_position ? ` (${st.queue_position} ahead)` : ""}` : "Making it on fal.ai")
      await sleep(Math.min(3000, pollMs * (1 + i / 5)), signal)
    }
    const result = await call(job.response_url)
    return { files: filesIn(result), model: app.model, sound: !!app.sound }
  } finally {
    signal?.removeEventListener("abort", cancel)
  }
}
