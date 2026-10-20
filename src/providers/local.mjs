// "This computer": runs the apps on this machine with stable-diffusion.cpp (see
// src/engine/), no account, no key and no GPU server. Each app maps to a
// model pack and a request (src/engine/catalog.mjs); the engine keeps that
// pack's sd-server loaded between jobs. Smooth motion needs no model at all:
// ffmpeg's motion-compensated interpolation does it. Apps whose models are too
// big for a personal computer say so and point to a GPU server instead.

import { readFile, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { FFMPEG_APPS, RECIPES, packForApp } from "../engine/catalog.mjs"
import { imageSize } from "../library.mjs"
import { hasFfmpeg, probe, run } from "../media/ffmpeg.mjs"
import { CanceledError, mimeFor, sleep } from "./common.mjs"

export class LocalProvider {
  constructor({ engine, pollMs = 600 }) {
    if (!engine) throw new Error("This computer's engine isn't available in this build.")
    this.engine = engine
    this.pollMs = pollMs
    this.id = "local"
    this.label = "This computer"
  }

  async status(modelsByApp = {}) {
    const st = this.engine.status()
    const ffmpeg = await hasFfmpeg()
    const apps = {}
    for (const appId of Object.keys(modelsByApp)) {
      const pack = packForApp(appId)
      if (FFMPEG_APPS.has(appId)) apps[appId] = ffmpeg ? { ready: true, missing: [] } : { ready: false, missing: [], reason: "needs ffmpeg installed" }
      else if (!pack) apps[appId] = { ready: false, missing: [], reason: "needs a GPU server (ComfyUI or RunPod)" }
      else {
        const p = st.packs.find((x) => x.id === pack.id)
        apps[appId] = p.ready && st.installed ? { ready: true, missing: [] } : { ready: false, missing: p.files.filter((f) => !f.present).map((f) => ({ name: f.name })), reason: st.installed ? `needs the ${p.label} pack` : "needs the engine installed" }
      }
    }
    const ready = st.packs.filter((p) => p.ready)
    return {
      ok: st.installed,
      label: st.installed
        ? `This computer · ${ready.length ? ready.map((p) => p.label.toLowerCase()).join(", ") : "no model packs yet"}`
        : "This computer · not set up yet (Settings → This computer)",
      engine: st,
      apps,
    }
  }

  async run({ app, values, inputs = {}, workDir, onProgress = () => {}, signal }) {
    if (FFMPEG_APPS.has(app.id)) return this.smooth({ values, inputs, workDir, onProgress, signal })
    const pack = packForApp(app.id)
    if (!pack) throw new Error(`${app.label} (${app.model}) is too big to run on this computer. Connect a GPU server in Settings (ComfyUI or RunPod) for it.`)
    if (!this.engine.installed()) throw new Error("This computer isn't set up yet: install the engine in Settings → This computer.")
    if (!this.engine.packReady(pack)) throw new Error(`Download the “${pack.label}” pack in Settings → This computer to use ${app.label}.`)
    if (!pack.server) return this.upscale({ pack, values, inputs, workDir, onProgress, signal })

    const images = {}
    for (const key of ["image", "image2"]) if (inputs[key]) images[key] = await dataUrl(inputs[key])
    const size = inputs.image ? imageSize(inputs.image) : null
    const { kind, body } = RECIPES[app.id]({ values, prompt: promptFor(app, values), images, size })
    // Previews are what carry the step count; "proj" is the cheapest kind.
    Object.assign(body, { preview: "proj", preview_interval: 1 })

    onProgress(0.02, "Starting the engine")
    const server = await this.engine.server(pack, {
      signal,
      onWait: (s) => onProgress(0.03, s < 3 ? "Starting the engine" : `Loading ${pack.model} into memory (${s}s)`),
    })
    let result
    try {
      const id = await server.submit(kind, body, signal)
      const onAbort = () => server.cancel(id)
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        result = await this.follow(server, id, { signal, onProgress })
      } finally {
        signal?.removeEventListener("abort", onAbort)
      }
    } finally {
      this.engine.release()
    }

    onProgress(0.96, "Saving")
    if (kind === "vid_gen") return [await this.saveVideo(result, workDir, signal)]
    const images64 = result?.images ?? []
    if (!images64.length) throw new Error("The engine finished but returned no picture.")
    return images64.map((img, i) => ({ data: Buffer.from(img.b64_json, "base64"), filename: `result${i ? `-${i + 1}` : ""}.png`, mime: "image/png" }))
  }

  /** Poll a job until it's done, turning its step count into progress. */
  async follow(server, id, { signal, onProgress }) {
    while (true) {
      if (signal?.aborted) throw new CanceledError()
      const job = await server.job(id, signal)
      if (job.status === "completed") return job.result
      if (job.status === "cancelled") throw new CanceledError()
      if (job.status === "failed") throw new Error(job.error?.message ? `The engine couldn't make it: ${job.error.message}` : `The engine couldn't make it.\n${server.tail(6)}`)
      if (job.status === "queued") onProgress(0.05, "Waiting for the engine")
      if (job.status === "generating") {
        const p = job.preview
        if (p?.total_steps) onProgress(0.08 + 0.86 * Math.min(1, p.step / p.total_steps), `Step ${p.step} of ${p.total_steps}${p.pass > 1 ? ` (pass ${p.pass})` : ""}`)
        else onProgress(0.08, "Generating")
      }
      await sleep(this.pollMs, signal)
    }
  }

  /** sd-server returns WebM; the library and the ad editor want MP4. */
  async saveVideo(result, workDir, signal) {
    if (!result?.b64_json) throw new Error("The engine finished but returned no video.")
    const ext = { webm: ".webm", webp: ".webp", avi: ".avi" }[result.output_format] ?? ".webm"
    const raw = join(workDir, `raw${ext}`)
    await writeFile(raw, Buffer.from(result.b64_json, "base64"))
    if (!(await hasFfmpeg())) return { path: raw, filename: `result${ext}`, mime: mimeFor(raw) }
    const out = join(workDir, "result.mp4")
    await run("ffmpeg", ["-y", "-v", "error", "-i", raw, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], { signal })
    return { path: out, filename: "result.mp4", mime: "video/mp4" }
  }

  /** Upscaling: one sd-cli run at the model's 4x, scaled down for 2x. */
  async upscale({ pack, values, inputs, workDir, onProgress, signal }) {
    if (!inputs.image) throw new Error("Add an image to upscale.")
    onProgress(0.1, "Upscaling")
    const four = join(workDir, "x4.png")
    await this.engine.upscale({ input: inputs.image, output: four, model: this.engine.modelPath(pack.files.upscaler.name), signal })
    if (values.scale === "4x" || !(await hasFfmpeg())) return [{ path: four, filename: "result.png", mime: "image/png" }]
    onProgress(0.9, "Resizing to 2x")
    const out = join(workDir, "result.png")
    await run("ffmpeg", ["-y", "-v", "error", "-i", four, "-vf", "scale=iw/2:ih/2:flags=lanczos", out], { signal })
    return [{ path: out, filename: "result.png", mime: "image/png" }]
  }

  /** Smooth motion without a model: ffmpeg's motion-compensated interpolation. */
  async smooth({ values, inputs, workDir, onProgress, signal }) {
    if (!(await hasFfmpeg())) throw new Error("Smooth motion on this computer needs ffmpeg installed.")
    if (!inputs.video) throw new Error("Add a video to smooth.")
    const info = await probe(inputs.video)
    const factor = values.factor === "4x" ? 4 : 2
    const fps = Math.min(120, Math.round((info.fps || 24) * factor))
    const out = join(workDir, "result.mp4")
    onProgress(0.1, `Interpolating to ${fps} fps`)
    await run(
      "ffmpeg",
      ["-y", "-v", "error", "-i", inputs.video, "-vf", `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out],
      { signal, timeoutMs: 30 * 60_000 },
    )
    return [{ path: out, filename: "result.mp4", mime: "video/mp4" }]
  }
}

/** The prompt as the app writes it for its model (style, camera and sound words). */
export function promptFor(app, values) {
  const p = app.params.find((x) => x.id === "prompt")
  if (!p) return ""
  return p.map ? p.map(values.prompt ?? "", values) : (values.prompt ?? "")
}

async function dataUrl(path) {
  const mime = mimeFor(path) === "application/octet-stream" ? `image/${extname(path).slice(1) || "png"}` : mimeFor(path)
  return `data:${mime};base64,${(await readFile(path)).toString("base64")}`
}
