// Thin ffmpeg/ffprobe wrapper. ffmpeg is Kino's one external program: it renders
// the instant camera moves, thumbnails and the Ad Studio's final cut. Everything
// else about the studio works without it.

import { spawn } from "node:child_process"

export function run(cmd, args, { timeoutMs = 10 * 60_000, onStdout, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], signal })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.stdout.on("data", (d) => {
      if (onStdout) onStdout(String(d))
      else stdout += d
    })
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-20_000)))
    child.on("error", (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} exited ${code}: ${stderr.split("\n").slice(-6).join(" ").trim()}`))
    })
  })
}

let available
/** Forget the answer, e.g. after Kino fetched ffmpeg itself. */
export const recheckFfmpeg = () => (available = undefined)

export async function hasFfmpeg() {
  if (available === undefined) {
    available = await run("ffmpeg", ["-hide_banner", "-version"], { timeoutMs: 10_000 }).then(
      () => true,
      () => false,
    )
  }
  return available
}

export async function probe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 30_000 })
  const info = JSON.parse(stdout)
  const video = info.streams.find((s) => s.codec_type === "video")
  const audio = info.streams.find((s) => s.codec_type === "audio")
  const duration = Number(info.format?.duration ?? video?.duration ?? 0)
  const [num, den] = String(video?.avg_frame_rate ?? video?.r_frame_rate ?? "0/1").split("/").map(Number)
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    duration: Number.isFinite(duration) ? duration : 0,
    fps: num && den ? num / den : 0,
    hasAudio: !!audio,
    codec: video?.codec_name ?? audio?.codec_name ?? "",
  }
}

/** A JPEG poster for the gallery: a frame from a video, or a downscaled image. */
export async function thumbnail(input, out, { at = 0.4, width = 640, isVideo = false } = {}) {
  const args = ["-y", "-v", "error"]
  if (isVideo) args.push("-ss", String(at))
  args.push("-i", input, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "4", out)
  await run("ffmpeg", args, { timeoutMs: 60_000 })
  return out
}

/** Escape a string for an ffmpeg filter argument value. */
export const filterEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'")
