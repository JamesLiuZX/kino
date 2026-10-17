// The instant camera move: a still photo becomes a short video using the same
// camera presets the AI video models get as words. It is a 2.5D move (zoom, pan,
// roll, shake) rendered by ffmpeg's zoompan from a 2x oversampled frame, so it is
// smooth, deterministic and costs nothing. Ads assembled from these plus captions
// are usable today, before a GPU is attached.

import { cameraById, aspectById } from "../presets.mjs"
import { run } from "./ffmpeg.mjs"

// Output sizes for drafts: 720p-class keeps renders to a few seconds.
const SIZES = {
  "9:16": [720, 1280],
  "1:1": [960, 960],
  "4:5": [864, 1080],
  "16:9": [1280, 720],
  "3:4": [810, 1080],
  "4:3": [1080, 810],
  "2:3": [720, 1080],
  "3:2": [1080, 720],
  "21:9": [1344, 576],
}

// `@` stands for progress 0..1; it is substituted per filter (zoompan counts
// frames in `on`, rotate in `n`).
const EASE = {
  linear: "@",
  in: "(@*@*@)",
  out: "(1-pow(1-@,3))",
  inout: "((1-cos(PI*@))/2)",
}

export function motionSize(aspectId) {
  return SIZES[aspectId] ?? SIZES["9:16"]
}

/** The draft size whose shape is closest to a picture's. */
export function nearestAspect({ width, height }) {
  if (!width || !height) return "9:16"
  const r = width / height
  return Object.entries(SIZES).reduce((best, [id, [w, h]]) => (Math.abs(Math.log(w / h / r)) < Math.abs(Math.log(SIZES[best][0] / SIZES[best][1] / r)) ? id : best), "9:16")
}

/** The zoompan/rotate/etc. filter chain for one preset, as a string. */
export function motionFilter({ camera = "push-in", width, height, frames, fps = 30 }) {
  const preset = cameraById(camera) ?? cameraById("push-in")
  const d = preset.draft
  const ease = EASE[d.ease ?? "inout"] ?? EASE.inout
  const curve = (counter) => ease.replaceAll("@", `(${counter}/${Math.max(1, frames - 1)})`)
  const lerpWith = (counter) => ([a, b]) => (a === b ? `${a}` : `(${a}+(${+(b - a).toFixed(4)})*${curve(counter)})`)
  const lerp = lerpWith("on")
  // Rolling the frame exposes its corners; zoom in enough to hide them.
  const rollMax = d.rot ? Math.max(...d.rot.map(Math.abs)) : 0
  const rollZoom = rollMax ? 1 + Math.sin((rollMax * Math.PI) / 180) * 1.6 : 1
  const z = `(${lerp(d.z)})*${rollZoom.toFixed(4)}`
  const shake = d.shake ? `+iw*${d.shake}*sin(on*0.9)*sin(on*0.37)` : ""
  const shakeY = d.shake ? `+ih*${d.shake}*sin(on*0.71)*cos(on*0.23)` : ""
  const x = `(iw-iw/zoom)*(${lerp(d.x)})${shake}`
  const y = `(ih-ih/zoom)*(${lerp(d.y)})${shakeY}`

  const W2 = width * 2
  const H2 = height * 2
  const chain = [
    `scale=${W2}:${H2}:force_original_aspect_ratio=increase`,
    `crop=${W2}:${H2}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=${fps}`,
  ]
  if (d.rot) chain.push(`rotate=a='(${lerpWith("n")(d.rot)})*PI/180':fillcolor=black`)
  if (d.blur) chain.push("tmix=frames=3")
  if (d.fadeIn) chain.push(`fade=t=in:st=0:d=${Math.min(1, frames / fps / 3).toFixed(2)}`)
  chain.push("format=yuv420p")
  return chain.join(",")
}

export async function renderMotion({ image, out, camera = "push-in", aspect = "9:16", duration = 4, fps = 30 }) {
  const [width, height] = motionSize(aspectById(aspect).id)
  const frames = Math.max(2, Math.round(duration * fps))
  const preset = cameraById(camera) ?? cameraById("push-in")
  let graph = `[0:v]${motionFilter({ camera, width, height, frames, fps })}[v]`
  if (preset.draft.focus) {
    // Rack focus: dissolve from a blurred copy of the move into the sharp one.
    graph = `[0:v]${motionFilter({ camera, width, height, frames, fps })},split[a][b];[b]gblur=sigma=10[bl];[bl][a]xfade=transition=fade:duration=${(duration * 0.5).toFixed(2)}:offset=${(duration * 0.15).toFixed(2)}[v]`
  }
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-i", image,
    "-filter_complex", graph,
    "-map", "[v]",
    "-frames:v", String(frames),
    "-r", String(fps),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-movflags", "+faststart",
    out,
  ])
  return { out, width, height, duration: frames / fps }
}
