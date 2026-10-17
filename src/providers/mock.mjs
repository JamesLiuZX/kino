// Demo mode: no GPU, real files. Images are seeded procedural renders (or your
// photo, processed); videos are real camera moves on them via ffmpeg. It exists
// so the whole studio (composer, queue, library, Ad Studio, exports) can be used
// and tested before a GPU is connected, and it never pretends to be a model:
// every result is labelled as a demo in the library.

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { proceduralImage } from "../media/png.mjs"
import { nearestAspect, renderMotion } from "../media/motion.mjs"
import { hasFfmpeg, probe, run } from "../media/ffmpeg.mjs"
import { sizeFor } from "../presets.mjs"
import { sleep } from "./common.mjs"

export class MockProvider {
  constructor({ stepMs = 160 } = {}) {
    this.id = "mock"
    this.label = "Demo mode"
    this.stepMs = stepMs
  }

  async status() {
    return { ok: true, label: "Demo mode: placeholder results, no GPU", apps: {} }
  }

  async run({ app, values, inputs = {}, workDir, onProgress = () => {}, signal }) {
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      await sleep(this.stepMs, signal)
      onProgress(0.05 + (i / steps) * 0.6, `Generating ${i}/${steps} (demo)`)
    }
    const seed = values.seed ?? 1
    const image = inputs.image ?? inputs.image_1
    const tmp = (name) => join(workDir, name)

    if (app.output === "image") {
      if (image && (await hasFfmpeg())) {
        const out = tmp("result.png")
        const filter =
          app.tool === "enhance"
            ? `scale=iw*${values.scale === "4x" ? 4 : 2}:ih*${values.scale === "4x" ? 4 : 2}:flags=lanczos,unsharp=5:5:0.8`
            : app.tool === "cutout"
              ? "format=rgba,colorkey=0xF4F1EA:0.18:0.08,colorkey=white:0.12:0.06"
              : `eq=saturation=1.25:contrast=1.06:gamma=1.04,hue=h=${(seed % 40) - 20},vignette=PI/5`
        await run("ffmpeg", ["-y", "-v", "error", "-i", image, "-vf", filter, "-frames:v", "1", out])
        onProgress(0.95, "Saving")
        return [{ path: out, filename: "result.png", mime: "image/png" }]
      }
      const { width, height } = values.width && values.height ? { width: values.width, height: values.height } : sizeFor(values.aspect ?? "1:1", 0.6, 16)
      const png = proceduralImage({ width: Math.min(width, 1536), height: Math.min(height, 1536), seed, prompt: values.prompt ?? "" })
      onProgress(0.95, "Saving")
      return [{ data: png, filename: "result.png", mime: "image/png" }]
    }

    if (!(await hasFfmpeg())) throw new Error("Demo videos need ffmpeg installed on this machine.")

    // Video tools that start from a video.
    const video = inputs.video ?? inputs.video_1
    if (video) {
      const out = tmp("result.mp4")
      const vf = app.id === "smooth" ? `framerate=fps=${values.factor === "4x" ? 96 : 48}` : `scale=trunc(iw*${values.scale === "3x" ? 3 : 2}/2)*2:-2:flags=lanczos`
      await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", out])
      return [{ path: out, filename: "result.mp4", mime: "video/mp4" }]
    }

    let still = image
    // Image-to-video apps without an aspect control follow the photo's shape.
    const aspect = values.aspect ?? (image ? nearestAspect(await probe(image)) : "9:16")
    if (!still) {
      const { width, height } = sizeFor(aspect, 0.9, 16)
      still = tmp("still.png")
      await writeFile(still, proceduralImage({ width, height, seed, prompt: values.prompt ?? "" }))
    }
    onProgress(0.75, "Rendering motion (demo)")
    const motion = tmp("motion.mp4")
    await renderMotion({ image: still, out: motion, camera: values.camera ?? "push-in", aspect, duration: Number(values.duration) || 4 })

    if (inputs.audio) {
      const out = tmp("result.mp4")
      await run("ffmpeg", ["-y", "-v", "error", "-stream_loop", "-1", "-i", motion, "-i", inputs.audio, "-map", "0:v", "-map", "1:a", "-shortest", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", out])
      return [{ path: out, filename: "result.mp4", mime: "video/mp4" }]
    }
    return [{ path: motion, filename: "result.mp4", mime: "video/mp4" }]
  }
}
