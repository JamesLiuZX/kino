// The web demo's renderers. Camera moves are the instant mode's maths (see
// src/media/motion.mjs) drawn on a canvas; ads use the server's own caption and
// end-card layout (src/ads/captions.mjs); everything is recorded in real time
// with MediaRecorder. AI stills are honest stand-ins: they say what a model
// would make, they don't pretend to be it.

import { cameraById } from "./lib/presets.js"
import { wrap, typeScale, endCardPlan } from "./lib/ads/captions.js"
import { platformById } from "./lib/ads/platforms.js"

const FPS = 30
const SCALE = 0.5 // web renders at half the server's size: smooth to record, sharp on a phone

// Same shapes as the instant mode, at web size.
const SIZES = { "9:16": [720, 1280], "1:1": [960, 960], "4:5": [864, 1080], "16:9": [1280, 720], "3:4": [810, 1080], "4:3": [1080, 810], "2:3": [720, 1080], "3:2": [1080, 720], "21:9": [1344, 576] }
export const sizeFor = (aspect, scale = 0.75) => (SIZES[aspect] ?? SIZES["9:16"]).map((n) => Math.round((n * scale) / 2) * 2)

const EASE = { linear: (p) => p, in: (p) => p * p * p, out: (p) => 1 - (1 - p) ** 3, inout: (p) => (1 - Math.cos(Math.PI * p)) / 2 }
const lerp = ([a, b], p) => a + (b - a) * p
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))

const SANS = `"Inter", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", "WenQuanYi Zen Hei", system-ui, sans-serif`
const SERIF = `"Instrument Serif", Georgia, "Songti SC", serif`

// ---------------------------------------------------------------- media

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That picture couldn't be read."))
    img.src = url
  })
}

const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h })
export const toBlob = (c, type = "image/jpeg", quality = 0.9) => new Promise((ok) => c.toBlob(ok, type, quality))

/** Draw an image to cover a box (like CSS object-fit: cover). */
function cover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const s = Math.max(w / iw, h / ih)
  ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s)
}

// ---------------------------------------------------------------- camera moves

/** One frame of a camera move over a still, at progress p (0..1). */
export function cameraFrame(ctx, img, presetId, p, n, W, H, seconds) {
  const d = (cameraById(presetId) ?? cameraById("push-in")).draft
  const e = (EASE[d.ease ?? "inout"] ?? EASE.inout)(clamp(p))
  // Rolling the frame exposes its corners; zoom in enough to hide them.
  const rollMax = d.rot ? Math.max(...d.rot.map(Math.abs)) : 0
  const rollZoom = rollMax ? 1 + Math.sin((rollMax * Math.PI) / 180) * 1.6 : 1
  const zoom = lerp(d.z, e) * rollZoom
  const shakeX = d.shake ? W * d.shake * Math.sin(n * 0.9) * Math.sin(n * 0.37) : 0
  const shakeY = d.shake ? H * d.shake * Math.sin(n * 0.71) * Math.cos(n * 0.23) : 0
  const x = (W - W / zoom) * lerp(d.x, e) + shakeX
  const y = (H - H / zoom) * lerp(d.y, e) + shakeY
  ctx.save()
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, W, H)
  if (d.rot) {
    ctx.translate(W / 2, H / 2)
    ctx.rotate((lerp(d.rot, e) * Math.PI) / 180)
    ctx.translate(-W / 2, -H / 2)
  }
  if (d.focus && seconds) ctx.filter = `blur(${(10 * SCALE * (1 - clamp((p * seconds - seconds * 0.15) / (seconds * 0.5)))).toFixed(2)}px)`
  ctx.scale(zoom, zoom)
  ctx.translate(-x, -y)
  cover(ctx, img, 0, 0, W, H)
  ctx.restore()
  if (d.fadeIn && seconds) {
    const a = 1 - clamp((p * seconds) / Math.min(1, seconds / 3))
    if (a > 0) {
      ctx.fillStyle = `rgba(0,0,0,${a})`
      ctx.fillRect(0, 0, W, H)
    }
  }
}

// ---------------------------------------------------------------- recording

function pickMime(audio) {
  const types = audio
    ? ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
    : ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? ""
}

export const canceled = () => Object.assign(new Error("Canceled"), { canceled: true })

/**
 * Record `seconds` of a drawing in real time. draw(ctx, t, frame) paints the
 * frame for time t. audio(ctx, destination, seconds) may schedule sound.
 * Resolves to { blob, mime, ext, width, height, duration, poster }.
 */
export async function record({ width, height, seconds, draw, audio, onProgress = () => {}, signal }) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error("This browser can't record video. Try a recent Chrome, Edge, Firefox or Safari.")
  const c = canvas(width, height)
  const ctx = c.getContext("2d")
  draw(ctx, 0, 0)
  const stream = c.captureStream(FPS)
  let actx = null
  if (audio) {
    actx = new AudioContext()
    const dest = actx.createMediaStreamDestination()
    await audio(actx, dest, seconds)
    const track = dest.stream.getAudioTracks()[0]
    if (track) stream.addTrack(track)
  }
  const mimeType = pickMime(!!audio)
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 })
  const chunks = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise((ok) => (rec.onstop = ok))
  let poster = null
  const posterAt = Math.min(1.2, seconds * 0.35)
  rec.start(250)
  const t0 = performance.now()
  let frame = 0
  try {
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted) return reject(canceled())
        const t = (performance.now() - t0) / 1000
        if (t >= seconds) return resolve()
        draw(ctx, t, frame++)
        if (!poster && t >= posterAt) poster = toBlob(c, "image/jpeg", 0.82)
        onProgress(t / seconds)
        // Background tabs pause animation frames; a timer keeps the clock moving.
        if (document.hidden) setTimeout(tick, 1000 / FPS)
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    draw(ctx, seconds, frame)
    await new Promise((ok) => setTimeout(ok, 120))
  } finally {
    if (rec.state !== "inactive") rec.stop()
    await stopped
    stream.getTracks().forEach((t) => t.stop())
    actx?.close().catch(() => {})
  }
  const type = (rec.mimeType || mimeType || "video/webm").split(";")[0]
  let blob = new Blob(chunks, { type })
  if (type === "video/webm") blob = await withWebmDuration(blob, seconds)
  return { blob, mime: type, ext: type.includes("mp4") ? "mp4" : "webm", width, height, duration: seconds, poster: poster ? await poster : await toBlob(c, "image/jpeg", 0.82) }
}

export async function cameraMove({ image, camera = "push-in", aspect = "9:16", duration = 4, onProgress, signal }) {
  const img = await loadImage(image)
  const [W, H] = sizeFor(aspect)
  const seconds = clamp(Number(duration) || 4, 1, 12)
  return record({ width: W, height: H, seconds, onProgress, signal, draw: (ctx, t, n) => cameraFrame(ctx, img, camera, t / seconds, n, W, H, seconds) })
}

// ---------------------------------------------------------------- stand-in stills

const PALETTES = [
  ["#fff1dc", "#f2c08e", "#b97a5c"],
  ["#f3efff", "#c9bdf5", "#7c6bc9"],
  ["#e9f6f1", "#a9dcc8", "#4f8f7a"],
  ["#fdf0f0", "#f0b9b4", "#b5605a"],
  ["#eef5ff", "#b8d4f5", "#5a7fb8"],
  ["#fbf6e6", "#ecd99a", "#a38633"],
]
const hash = (s) => [...String(s)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)

function wash(ctx, W, H, palette) {
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H)
  g.addColorStop(0, palette[0])
  g.addColorStop(0.55, palette[1])
  g.addColorStop(1, palette[2])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W * 0.68, H * 0.28, 0, W * 0.68, H * 0.28, Math.max(W, H) * 0.55)
  glow.addColorStop(0, "rgba(255,255,255,0.75)")
  glow.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
}

function lines(ctx, text, maxWidth, maxLines) {
  const words = /[　-鿿]/.test(text) ? [...text] : text.split(/\s+/)
  const sep = /[　-鿿]/.test(text) ? "" : " "
  const out = []
  let line = ""
  for (const w of words) {
    const next = line ? line + sep + w : w
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line)
      line = w
      if (out.length === maxLines) break
    } else line = next
  }
  if (out.length < maxLines && line) out.push(line)
  if (out.length === maxLines && words.join(sep).length > out.join(sep).length) out[maxLines - 1] = out[maxLines - 1].replace(/.{0,2}$/, "…")
  return out
}

function label(ctx, W, H, text) {
  const s = Math.round(Math.min(W, H) * 0.026)
  ctx.font = `600 ${s}px ${SANS}`
  const w = ctx.measureText(text).width + s * 1.6
  ctx.fillStyle = "rgba(255,255,255,0.88)"
  roundRect(ctx, s, H - s * 3.2, w, s * 2, s)
  ctx.fill()
  ctx.fillStyle = "#3a3542"
  ctx.fillText(text, s * 1.8, H - s * 1.85)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h)
}

/** A generated scene's stand-in: a soft wash with the shot's description. */
export async function sceneStill({ text = "", aspect = "9:16", seed = 0, tag = "AI scene · demo" }) {
  const [W, H] = sizeFor(aspect, 1)
  const c = canvas(W, H)
  const ctx = c.getContext("2d")
  wash(ctx, W, H, PALETTES[(hash(text) + seed) % PALETTES.length])
  const size = Math.round(Math.min(W, H) * 0.075)
  ctx.font = `italic 400 ${size}px ${SERIF}`
  ctx.fillStyle = "rgba(21,19,26,0.82)"
  ctx.textAlign = "center"
  const short = text.split(/[,.;]/)[0].trim() || "A new scene"
  const ls = lines(ctx, short.charAt(0).toUpperCase() + short.slice(1), W * 0.78, 4)
  ls.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.4 + (i - (ls.length - 1) / 2) * size * 1.18))
  ctx.textAlign = "left"
  label(ctx, W, H, tag)
  return { blob: await toBlob(c), mime: "image/jpeg", ext: "jpg", width: W, height: H }
}

const STYLE_TINTS = {
  cinematic: ["#0d2a3e", "#2a4a62", "#d9822b"],
  product: ["#f6f3ec", "#e4ddd0", "#c7c0b2"],
  ugc: ["#f1c27d", "#d08a6b", "#7b3a63"],
  "warm-home": ["#fff1dc", "#f2c08e", "#b97a5c"],
  ink: ["#f4f1ea", "#c9c4b8", "#3d3a36"],
  watercolor: ["#eef5ff", "#f3d9e6", "#b8d4f5"],
  "3d": ["#f3efff", "#c9bdf5", "#7c6bc9"],
}

/** Image from words: a typeset card of the prompt, clearly a stand-in. */
export async function textImage({ prompt = "", style = "none", aspect = "1:1", seed = 0 }) {
  const [W, H] = sizeFor(aspect, 1)
  const c = canvas(W, H)
  const ctx = c.getContext("2d")
  wash(ctx, W, H, STYLE_TINTS[style] ?? PALETTES[(hash(prompt) + seed) % PALETTES.length])
  const dark = style === "cinematic"
  const size = Math.round(Math.min(W, H) * 0.068)
  ctx.font = `italic 400 ${size}px ${SERIF}`
  ctx.fillStyle = dark ? "rgba(255,255,255,0.92)" : "rgba(21,19,26,0.85)"
  ctx.textAlign = "center"
  const ls = lines(ctx, prompt.trim() || "Your image", W * 0.8, 5)
  ls.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.46 + (i - (ls.length - 1) / 2) * size * 1.2))
  ctx.textAlign = "left"
  label(ctx, W, H, "Demo · the image model runs in the full studio")
  return { blob: await toBlob(c), mime: "image/jpeg", ext: "jpg", width: W, height: H }
}

// Scenes the "product photo, new scene" task offers, matched by their words.
const SCENE_LOOKS = [
  { test: /marble/i, bg: ["#f7f6f4", "#e6e3df", "#c9c4bd"], floor: "#ece9e4" },
  { test: /teak|wood/i, bg: ["#fff3df", "#e9c79b", "#9c6b45"], floor: "#b58256" },
  { test: /gift|festive|red/i, bg: ["#fff0e6", "#e7a28c", "#a3352b"], floor: "#c4513f" },
  { test: /bedside|lamp|evening/i, bg: ["#ffe9cf", "#d79b6c", "#5b3a3a"], floor: "#7a4f3f" },
  { test: /plant|sun/i, bg: ["#f4fbef", "#bfe0b0", "#5f8f5a"], floor: "#d9caa8" },
  { test: /studio|clean|white/i, bg: ["#ffffff", "#f1efec", "#dcd8d2"], floor: "#efece8" },
]

/** Product photo in a new scene: the real cut-out on a lit set, with a contact shadow. */
export async function productScene({ product, prompt = "" }) {
  const look = SCENE_LOOKS.find((s) => s.test.test(prompt)) ?? SCENE_LOOKS[0]
  const W = 1080
  const H = 1080
  const c = canvas(W, H)
  const ctx = c.getContext("2d")
  wash(ctx, W, H, look.bg)
  const floorY = H * 0.74
  const fg = ctx.createLinearGradient(0, floorY, 0, H)
  fg.addColorStop(0, look.floor)
  fg.addColorStop(1, shade(look.floor, -0.18))
  ctx.fillStyle = fg
  ctx.fillRect(0, floorY, W, H - floorY)
  const img = await loadImage(product)
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  const h = H * 0.62
  const w = (iw / ih) * h
  const x = (W - w) / 2
  const y = floorY - h * 0.97
  ctx.save()
  ctx.filter = "blur(18px)"
  ctx.fillStyle = "rgba(0,0,0,0.32)"
  ctx.beginPath()
  ctx.ellipse(W / 2, floorY + 6, w * 0.55, 22, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.drawImage(img, x, y, w, h)
  const light = ctx.createLinearGradient(0, 0, W, H)
  light.addColorStop(0, "rgba(255,240,220,0.18)")
  light.addColorStop(1, "rgba(0,0,0,0.08)")
  ctx.fillStyle = light
  ctx.fillRect(0, 0, W, H)
  label(ctx, W, H, "Demo · your real product, a stand-in set")
  return { blob: await toBlob(c), mime: "image/jpeg", ext: "jpg", width: W, height: H }
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16)
  const f = (v) => Math.round(clamp(v + 255 * amt, 0, 255))
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`
}

const GRADES = [
  { test: /night|dark|moon/i, filter: "brightness(0.72) saturate(0.85) hue-rotate(12deg) contrast(1.08)", tint: "rgba(30,40,90,0.18)" },
  { test: /snow|winter|cold|cool/i, filter: "brightness(1.08) saturate(0.8) hue-rotate(-8deg)", tint: "rgba(200,225,255,0.16)" },
  { test: /black and white|monochrome|b&w/i, filter: "grayscale(1) contrast(1.1)", tint: null },
  { test: /.*/, filter: "sepia(0.35) saturate(1.35) hue-rotate(-12deg) brightness(1.04)", tint: "rgba(255,190,120,0.12)" },
]

/** Change a photo: a colour grade that follows the words (warm light by default). */
export async function gradeImage({ image, prompt = "" }) {
  const img = await loadImage(image)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const c = canvas(W, H)
  const ctx = c.getContext("2d")
  const g = GRADES.find((x) => x.test.test(prompt))
  ctx.filter = g.filter
  ctx.drawImage(img, 0, 0)
  ctx.filter = "none"
  if (g.tint) {
    ctx.fillStyle = g.tint
    ctx.fillRect(0, 0, W, H)
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
  v.addColorStop(0, "rgba(0,0,0,0)")
  v.addColorStop(1, "rgba(0,0,0,0.22)")
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
  label(ctx, W, H, "Demo · the edit model runs in the full studio")
  return { blob: await toBlob(c), mime: "image/jpeg", ext: "jpg", width: W, height: H }
}

/** A soft oval cut-out, for photos the demo has no real cut-out of. */
export async function softCutout({ image }) {
  const img = await loadImage(image)
  const W = img.naturalWidth
  const H = img.naturalHeight
  const c = canvas(W, H)
  const ctx = c.getContext("2d")
  ctx.drawImage(img, 0, 0)
  ctx.globalCompositeOperation = "destination-in"
  const m = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.min(W, H) * 0.5)
  m.addColorStop(0, "rgba(0,0,0,1)")
  m.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = m
  ctx.fillRect(0, 0, W, H)
  return { blob: await toBlob(c, "image/png"), mime: "image/png", ext: "png", width: W, height: H }
}

export async function upscale({ image, scale = "2x" }) {
  const img = await loadImage(image)
  const k = scale === "4x" ? 4 : 2
  const W = Math.min(4096, img.naturalWidth * k)
  const H = Math.round((img.naturalHeight / img.naturalWidth) * W)
  const c = canvas(W, H)
  const ctx = c.getContext("2d")
  ctx.imageSmoothingQuality = "high"
  ctx.filter = "contrast(1.04) saturate(1.03)"
  ctx.drawImage(img, 0, 0, W, H)
  return { blob: await toBlob(c, "image/jpeg", 0.92), mime: "image/jpeg", ext: "jpg", width: W, height: H }
}

/** Make it talk: the photo breathes while your recording plays. No lip sync in the demo. */
export async function talkingPhoto({ image, audio, duration = 6, onProgress, signal }) {
  const img = await loadImage(image)
  const [W, H] = sizeFor("9:16")
  let buffer = null
  if (audio) {
    const data = await (await fetch(audio)).arrayBuffer()
    const decoder = new AudioContext()
    try {
      buffer = await decoder.decodeAudioData(data)
    } finally {
      decoder.close().catch(() => {})
    }
  }
  const seconds = clamp(buffer ? buffer.duration + 0.3 : Number(duration) || 6, 1, 15.5)
  return record({
    width: W,
    height: H,
    seconds,
    onProgress,
    signal,
    audio: buffer
      ? async (actx, dest) => {
          const src = actx.createBufferSource()
          src.buffer = buffer
          src.connect(dest)
          src.start(actx.currentTime + 0.15)
        }
      : null,
    draw: (ctx, t) => {
      const breathe = 1.06 + 0.012 * Math.sin(t * 2.4) + 0.02 * (t / seconds)
      ctx.save()
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, W, H)
      ctx.translate(W / 2, H * 0.45)
      ctx.scale(breathe, breathe)
      ctx.rotate(0.008 * Math.sin(t * 1.3))
      ctx.translate(-W / 2, -H * 0.45)
      cover(ctx, img, 0, 0, W, H)
      ctx.restore()
    },
  })
}

// ---------------------------------------------------------------- the ad editor

/** A soft chord pad, like the server's "calm" music bed. */
function calmPad(actx, dest, seconds) {
  const chords = [
    [130.81, 164.81, 196.0, 246.94],
    [110.0, 130.81, 164.81, 196.0],
    [87.31, 110.0, 130.81, 164.81],
    [98.0, 123.47, 146.83, 164.81],
  ]
  const master = actx.createGain()
  const lp = actx.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 1500
  const echo = actx.createDelay()
  echo.delayTime.value = 0.17
  const fb = actx.createGain()
  fb.gain.value = 0.22
  lp.connect(master)
  lp.connect(echo)
  echo.connect(fb)
  fb.connect(echo)
  echo.connect(master)
  master.connect(dest)
  const t0 = actx.currentTime + 0.05
  master.gain.setValueAtTime(0, t0)
  master.gain.linearRampToValueAtTime(0.5, t0 + 1)
  master.gain.setValueAtTime(0.5, t0 + Math.max(1, seconds - 1.6))
  master.gain.linearRampToValueAtTime(0, t0 + seconds)
  const seg = 5
  const fade = 1.5
  for (let i = 0, start = 0; start < seconds; i++, start += seg - fade) {
    const g = actx.createGain()
    g.connect(lp)
    g.gain.setValueAtTime(0, t0 + start)
    g.gain.linearRampToValueAtTime(1, t0 + start + fade)
    g.gain.setValueAtTime(1, t0 + start + seg - fade)
    g.gain.linearRampToValueAtTime(0, t0 + start + seg)
    for (const f of chords[i % chords.length]) {
      for (const [freq, amp] of [
        [f, 0.045],
        [f * 1.0035, 0.0315],
      ]) {
        const o = actx.createOscillator()
        const a = actx.createGain()
        o.frequency.value = freq
        a.gain.value = amp
        o.connect(a)
        a.connect(g)
        o.start(t0 + start)
        o.stop(t0 + start + seg + 0.05)
      }
    }
  }
}

/**
 * Edit a finished ad: each shot is a still with its camera move, captions and
 * the hook follow the server's layout, then the end card with the product
 * cut-out. clips: one image URL per shot, in order.
 */
export async function renderAd({ brief, brand, clips, cutout, platform, onProgress, signal }) {
  const p = platformById(platform ?? brief.platform)
  // Layout happens at the platform's full size, exactly as the server does it;
  // the canvas is half that, so every frame starts with a 0.5 scale.
  const [W, H] = p.size
  const [CW, CH] = p.size.map((n) => Math.round((n * SCALE) / 2) * 2)
  const k = W / 1080
  const safe = p.safe
  const colors = { primary: "#7F351E", text: "#2B1A12", background: "#FBF4E8", ...(brand.colors ?? {}) }
  const images = await Promise.all(clips.map(loadImage))
  const product = cutout ? await loadImage(cutout) : null
  const shots = brief.shots.map((s, i) => ({ ...s, img: images[i] }))
  const endSeconds = brief.endCard?.seconds ?? 2.5
  const total = +(shots.reduce((a, s) => a + s.seconds, 0) + endSeconds).toFixed(2)

  const timeline = []
  let t = 0
  shots.forEach((s, i) => {
    const hook = i === 0 && brief.hook
    timeline.push({ start: t + 0.04, end: t + s.seconds - 0.04, text: hook ? brief.hook : s.caption, kind: hook ? "hook" : "caption" })
    if (hook && s.caption && s.caption !== brief.hook) timeline.push({ start: t + Math.min(1.2, s.seconds / 2), end: t + s.seconds - 0.04, text: s.caption, kind: "caption" })
    t += s.seconds
  })
  const shotsEnd = t
  const { base, sizes, unitsFor } = typeScale(W, safe)
  const plan = endCardPlan({ width: W, height: H, safe, headline: brief.endCard?.headline, offer: brief.endCard?.offer, cta: brief.endCard?.cta })

  // A boxed caption block, like libass BorderStyle 3. anchor: "top" | "bottom".
  const caption = (text, size, y, anchor, alpha, scale, { color = "#fff", box = colors.primary, pad = 18 } = {}) => {
    if (!text || alpha <= 0) return
    const ls = wrap(text, unitsFor(size)).split("\n")
    const lh = size * 1.22
    const blockH = ls.length * lh
    const top = anchor === "top" ? y : y - blockH
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(W / 2, top + blockH / 2)
    ctx.scale(scale, scale)
    ctx.translate(-W / 2, -(top + blockH / 2))
    ctx.font = `700 ${size}px ${SANS}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ls.forEach((l, i) => {
      const w = ctx.measureText(l).width
      const cy = top + i * lh + lh / 2
      if (box) {
        ctx.fillStyle = hexA(box, 0.92)
        ctx.fillRect(W / 2 - w / 2 - pad * k, cy - lh / 2 - (i === 0 ? pad * k * 0.6 : 0), w + pad * 2 * k, lh + (i === 0 ? pad * k * 0.6 : 0) + (i === ls.length - 1 ? pad * k * 0.6 : 0))
      }
    })
    ls.forEach((l, i) => {
      ctx.fillStyle = color
      ctx.fillText(l, W / 2, top + i * lh + lh / 2)
    })
    ctx.restore()
  }
  let ctx = null
  const capY = H - (Math.round(safe.bottom * H) + 36 * k)
  const hookY = Math.round(safe.top * H) + 48 * k

  const draw = (c, time, n) => {
    ctx = c
    ctx.setTransform(CW / W, 0, 0, CH / H, 0, 0)
    if (time < shotsEnd) {
      let start = 0
      const i = shots.findIndex((s) => (start += s.seconds) > time)
      const s = shots[Math.max(0, i)]
      const from = start - s.seconds
      cameraFrame(ctx, s.img, s.camera, (time - from) / s.seconds, n, W, H, s.seconds)
    } else {
      const e = time - shotsEnd
      ctx.fillStyle = colors.background
      ctx.fillRect(0, 0, W, H)
      if (product) {
        const h = plan.productH
        const w = (product.naturalWidth / product.naturalHeight) * h
        ctx.save()
        ctx.globalAlpha = 0.28
        ctx.filter = `brightness(0) blur(${Math.round(22 * k)}px)`
        ctx.drawImage(product, (W - w) / 2 + 14 * k, plan.productTop + 26 * k, w, h)
        ctx.restore()
        ctx.drawImage(product, (W - w) / 2, plan.productTop, w, h)
      }
      const fade = (delay) => clamp((e - 0.15 - delay) / 0.2)
      caption(brief.endCard?.headline, sizes.headline, plan.y1, "top", fade(0), 1, { color: colors.primary, box: null })
      caption(brief.endCard?.offer, sizes.offer, plan.y2, "top", fade(0.15), 1, { color: colors.text, box: null })
      caption(brief.endCard?.cta, sizes.cta, plan.y3, "top", fade(0.3), 1, { color: "#fff", box: colors.primary, pad: 16 })
      const black = 1 - clamp(e / 0.3)
      if (black > 0) {
        ctx.fillStyle = `rgba(0,0,0,${black})`
        ctx.fillRect(0, 0, W, H)
      }
    }
    for (const c2 of timeline) {
      if (time < c2.start || time > c2.end) continue
      const inT = time - c2.start
      const outT = c2.end - time
      const alpha = Math.min(clamp(inT / 0.12), clamp(outT / 0.08))
      const scale = 0.92 + 0.08 * clamp(inT / 0.16)
      if (c2.kind === "hook") caption(c2.text, sizes.hook, hookY, "top", alpha, scale, { pad: 22 })
      else caption(c2.text, base, capY, "bottom", alpha, scale)
    }
  }

  return record({ width: CW, height: CH, seconds: total, draw, onProgress, signal, audio: brief.music === "calm" ? (actx, dest, sec) => calmPad(actx, dest, sec) : null })
}

function hexA(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

// ---------------------------------------------------------------- WebM duration

/**
 * MediaRecorder's WebM files leave out the duration, so players can't show a
 * timeline or seek. Insert a Duration element into the Segment Info (it sits
 * near the start; nothing after it uses absolute offsets in these files).
 */
async function withWebmDuration(blob, seconds) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let at = -1
  for (let i = 0; i < Math.min(buf.length - 4, 16384); i++) {
    if (buf[i] === 0x15 && buf[i + 1] === 0x49 && buf[i + 2] === 0xa9 && buf[i + 3] === 0x66) {
      at = i
      break
    }
  }
  if (at < 0) return blob
  const { value: size, length: sizeLen } = readVint(buf, at + 4)
  const start = at + 4 + sizeLen
  const end = start + size
  if (end > buf.length) return blob
  for (let i = start; i < end - 1; i++) if (buf[i] === 0x44 && buf[i + 1] === 0x89) return blob
  // Duration (0x4489): an 8-byte float in TimecodeScale units (1 ms in these files).
  const dur = new Uint8Array(11)
  dur.set([0x44, 0x89, 0x88])
  new DataView(dur.buffer).setFloat64(3, seconds * 1000)
  const newSize = writeVint(size + dur.length, sizeLen)
  const out = new Uint8Array(buf.length + dur.length + newSize.length - sizeLen)
  out.set(buf.subarray(0, at + 4), 0)
  out.set(newSize, at + 4)
  let o = at + 4 + newSize.length
  out.set(buf.subarray(start, end), o)
  o += size
  out.set(dur, o)
  out.set(buf.subarray(end), o + dur.length)
  return new Blob([out], { type: blob.type })
}

function readVint(buf, at) {
  let len = 1
  let mask = 0x80
  while (len <= 8 && !(buf[at] & mask)) {
    len++
    mask >>= 1
  }
  let value = buf[at] & (mask - 1)
  for (let i = 1; i < len; i++) value = value * 256 + buf[at + i]
  return { value, length: len }
}

function writeVint(value, minLen) {
  let len = minLen
  while (len < 8 && value >= 2 ** (7 * len) - 1) len++
  const out = new Uint8Array(len)
  let v = value
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256
    v = Math.floor(v / 256)
  }
  out[0] |= 0x80 >> (len - 1)
  return out
}

