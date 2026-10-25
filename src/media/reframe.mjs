// Reframing a picture to another shape (1:1, 4:5, 9:16...) without a model:
//   fill   crop to fill the frame
//   fit    the whole picture over a blurred, enlarged copy of itself
//   white  the whole picture on white, as marketplaces want a main image
// Transparent pictures (cut-outs) land on white for fit and white, and keep
// their transparency for fill. The geometry is shared by the server (ffmpeg)
// and the web demo (canvas), so it stays free of Node built-ins.

import { aspectById } from "../presets.mjs"

export const FITS = { fill: "Fill the frame (crop)", fit: "Whole picture, soft edges", white: "Whole picture on white" }
const MAX_SIDE = 2560

/** The output size for a width × height picture reframed to `aspect`. */
export function reframeSize({ width, height, aspect, fit = "fill" }) {
  const { w, h } = aspectById(aspect)
  const ratio = w / h
  // Fill keeps only pixels the picture has (the frame fits inside it); the
  // others keep the whole picture (the frame grows around it).
  const W = fit === "fill" ? Math.min(width, height * ratio) : Math.max(width, height * ratio)
  const scale = Math.min(1, MAX_SIDE / Math.max(W, W / ratio))
  const even = (n) => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(W), height: even(W / ratio) }
}

/** ffmpeg's -filter_complex for it: input [0:v], output [out]. */
export function reframeFilter({ width: W, height: H, fit = "fill" }) {
  if (fit === "fill") return `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[out]`
  const white = `color=c=white:s=${W}x${H}:r=1`
  const fg = `scale=${W}:${H}:force_original_aspect_ratio=decrease`
  if (fit === "white") return `${white}[bg];[0:v]${fg}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[out]`
  return [
    `${white}[base]`,
    `[0:v]split[a][b]`,
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=lr=min(w\\,h)/24:lp=2[blur]`,
    `[base][blur]overlay=shortest=1[bg]`,
    `[b]${fg}[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[out]`,
  ].join(";")
}
