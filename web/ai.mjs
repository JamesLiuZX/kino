// Real models in the web demo, run on the visitor's device with ONNX Runtime
// Web: IS-Net cuts the subject out of a photo, Real-ESRGAN enlarges it. WebGPU
// when the device has it, WebAssembly otherwise. The models are served with the
// demo (web/models, made by scripts/web-models.py), downloaded on first use and
// kept in the browser's cache, so the next visit starts straight away. Photos
// never leave the page.

const MANIFEST = new URL("./models/manifest.json", import.meta.url)
const ORT = new URL("./ort/", import.meta.url)

const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h })
const mb = (n) => (n / 1e6).toFixed(n < 1e7 ? 1 : 0)
const aborted = () => Object.assign(new Error("Canceled"), { canceled: true })

// ---------------------------------------------------------------- runtime

let runtime = null

/** ONNX Runtime with the best backend this device has. */
function ort() {
  if (runtime) return runtime
  runtime = (async () => {
    const adapter = await navigator.gpu?.requestAdapter?.().catch(() => null)
    const webgpu = !!adapter
    const variant = webgpu ? "ort-wasm-simd-threaded.asyncify" : "ort-wasm-simd-threaded"
    const mod = await import(new URL(webgpu ? "ort.webgpu.min.js" : "ort.wasm.min.js", ORT).href)
    const lib = mod.default ?? mod
    lib.env.wasm.wasmPaths = { mjs: new URL(`${variant}.js`, ORT).href, wasm: new URL(`${variant}.wasm`, ORT).href }
    lib.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
    lib.env.logLevel = "error"
    return { lib, backend: webgpu ? "webgpu" : "wasm" }
  })()
  runtime.catch(() => (runtime = null))
  return runtime
}

let manifest = null
/** The demo's models: file, size and name, from the manifest the build writes. */
export const models = () => (manifest ??= fetch(MANIFEST).then((r) => (r.ok ? r.json() : Promise.reject(new Error("The demo's models are missing.")))))

/** A model's bytes: from the browser's cache, or downloaded with progress. */
async function modelBytes(name, onProgress, signal) {
  const m = (await models())[name]
  const url = new URL(m.file, MANIFEST).href
  let cache = null
  try {
    cache = await caches.open("kino-models")
    const hit = await cache.match(url)
    if (hit) return new Uint8Array(await hit.arrayBuffer())
  } catch {
    cache = null
  }
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`The ${m.label} couldn't be downloaded (${res.status}).`)
  // The manifest has the exact size (a compressed response's length header wouldn't).
  const bytes = new Uint8Array(m.bytes)
  const reader = res.body.getReader()
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (got + value.length > bytes.length) throw new Error(`The ${m.label} download was larger than expected.`)
    bytes.set(value, got)
    got += value.length
    onProgress(got / bytes.length, `Downloading the ${m.label} · ${mb(got)} of ${mb(bytes.length)} MB, once`)
  }
  if (got !== bytes.length) throw new Error(`The ${m.label} download stopped part-way. Try again.`)
  cache?.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => {})
  return bytes
}

const sessions = new Map()

/** A ready inference session for one of the demo's models. */
function session(name, onProgress, signal) {
  if (!sessions.has(name)) {
    const ready = (async () => {
      const [{ lib, backend }, bytes] = await Promise.all([ort(), modelBytes(name, onProgress, signal)])
      onProgress(1, backend === "webgpu" ? "Starting the model on your graphics chip" : "Starting the model")
      if (backend === "webgpu") {
        try {
          return { s: await lib.InferenceSession.create(bytes, { executionProviders: ["webgpu"] }), lib, backend, bytes }
        } catch (e) {
          // Some graphics chips can't run every layer; the processor always can.
          console.warn(`[kino] the ${name} model can't start on WebGPU here, using WebAssembly:`, e)
        }
      }
      return { s: await lib.InferenceSession.create(bytes, { executionProviders: ["wasm"] }), lib, backend: "wasm", bytes }
    })()
    sessions.set(name, ready)
    ready.catch(() => sessions.delete(name))
  }
  return sessions.get(name)
}

const GPU_PATIENCE = 60_000 // a run (shaders compiled, model on the chip) never takes this long

/** Run a model; if the graphics chip fails or stalls, finish on the processor. */
async function infer(model, feeds) {
  if (model.backend !== "webgpu") return model.s.run(feeds)
  let timer
  try {
    const stalled = new Promise((_, no) => (timer = setTimeout(() => no(new Error("WebGPU stopped responding")), GPU_PATIENCE)))
    return await Promise.race([model.s.run(feeds), stalled])
  } catch (e) {
    console.warn("[kino] WebGPU failed while running a model, using WebAssembly:", e)
    const s = await model.lib.InferenceSession.create(model.bytes, { executionProviders: ["wasm"] })
    Object.assign(model, { s, backend: "wasm" })
    return s.run(feeds)
  } finally {
    clearTimeout(timer)
  }
}

/** Where the models run on this device: "webgpu" or "wasm". Loads nothing big. */
export async function device() {
  const adapter = await navigator.gpu?.requestAdapter?.().catch(() => null)
  return adapter ? "webgpu" : "wasm"
}

// ---------------------------------------------------------------- cut-out

const CUT = 1024 // IS-Net's input size

/**
 * Cut the subject out of a photo. Returns a PNG with a transparent background
 * at the photo's size (up to 2048 px), cropped to the subject when crop is set.
 */
export async function cutout(img, { onProgress = () => {}, signal, crop = false } = {}) {
  const model = await session("cutout", (p, msg) => onProgress(p * 0.55, msg), signal)
  if (signal?.aborted) throw aborted()
  onProgress(0.6, "Finding the subject")
  const c = canvas(CUT, CUT)
  const ctx = c.getContext("2d", { willReadFrequently: true })
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, 0, 0, CUT, CUT)
  const px = ctx.getImageData(0, 0, CUT, CUT).data
  const n = CUT * CUT
  const x = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    x[i] = px[i * 4] / 255 - 0.5
    x[i + n] = px[i * 4 + 1] / 255 - 0.5
    x[i + 2 * n] = px[i * 4 + 2] / 255 - 0.5
  }
  const out = await infer(model, { input_image: new model.lib.Tensor("float32", x, [1, 3, CUT, CUT]) })
  if (signal?.aborted) throw aborted()
  onProgress(0.92, "Cleaning the edges")
  const m = out.output_image.data
  let lo = Infinity
  let hi = -Infinity
  for (const v of m) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const span = hi - lo || 1
  const mask = ctx.createImageData(CUT, CUT)
  for (let i = 0; i < n; i++) {
    mask.data[i * 4 + 3] = Math.round(((m[i] - lo) / span) * 255)
  }
  out.output_image.dispose?.()
  ctx.putImageData(mask, 0, 0)

  // The mask, scaled smoothly to the photo, keeps the photo's own pixels.
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const k = Math.min(1, 2048 / Math.max(iw, ih))
  const W = Math.round(iw * k)
  const H = Math.round(ih * k)
  const result = canvas(W, H)
  const rctx = result.getContext("2d", { willReadFrequently: true })
  rctx.drawImage(img, 0, 0, W, H)
  rctx.globalCompositeOperation = "destination-in"
  rctx.imageSmoothingQuality = "high"
  rctx.drawImage(c, 0, 0, W, H)
  rctx.globalCompositeOperation = "source-over"

  const box = subjectBox(rctx, W, H)
  const final = crop && box ? canvas(box.w, box.h) : result
  if (final !== result) final.getContext("2d").drawImage(result, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
  const blob = await new Promise((ok) => final.toBlob(ok, "image/png"))
  return { blob, mime: "image/png", ext: "png", width: final.width, height: final.height, empty: !box, model: "IS-Net, in your browser" }
}

/**
 * A photo that's already a cut-out (it has a transparent background), cropped
 * to its subject as a PNG; null for an ordinary photo. No model needed.
 */
export async function trimmed(img) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const k = Math.min(1, 2048 / Math.max(iw, ih))
  const W = Math.round(iw * k)
  const H = Math.round(ih * k)
  const c = canvas(W, H)
  const ctx = c.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, W, H)
  const a = ctx.getImageData(0, 0, W, H).data
  let clear = 0
  for (let i = 3; i < a.length; i += 4) if (a[i] < 8) clear++
  if (clear < (W * H) / 50) return null
  const box = subjectBox(ctx, W, H)
  if (!box) return null
  const out = canvas(box.w, box.h)
  out.getContext("2d").drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
  const blob = await new Promise((ok) => out.toBlob(ok, "image/png"))
  return { blob, mime: "image/png", ext: "png", width: box.w, height: box.h }
}

/** The box around everything that isn't (nearly) transparent, with a small margin. */
function subjectBox(ctx, W, H) {
  const a = ctx.getImageData(0, 0, W, H).data
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (a[(y * W + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const pad = Math.round(Math.max(W, H) * 0.01)
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(W - 1, x1 + pad)
  y1 = Math.min(H - 1, y1 + pad)
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

// ---------------------------------------------------------------- upscale

const MAX_SIDE = 4096
const MAX_PIXELS = 16_000_000 // what every browser's canvas allows, phones included

/**
 * Enlarge a photo 2x or 4x with Real-ESRGAN (a 4x model). The model reads the
 * photo at up to 1024 px (640 px without WebGPU, to keep it quick), works in
 * overlapping tiles, and the result is scaled to exactly the size asked for.
 */
export async function upscale(img, { factor = 2, onProgress = () => {}, signal } = {}) {
  const model = await session("upscale", (p, msg) => onProgress(p * 0.08, msg), signal)
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const fit = Math.min(1, MAX_SIDE / (Math.max(iw, ih) * factor), Math.sqrt(MAX_PIXELS / (iw * ih * factor * factor)))
  const W = Math.round(iw * factor * fit)
  const H = Math.round(ih * factor * fit)
  const k = Math.min(1, (model.backend === "webgpu" ? 1024 : 640) / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * k))
  const h = Math.max(1, Math.round(ih * k))

  const src = canvas(w, h)
  const sctx = src.getContext("2d", { willReadFrequently: true })
  sctx.imageSmoothingQuality = "high"
  sctx.drawImage(img, 0, 0, w, h)
  const pixels = sctx.getImageData(0, 0, w, h).data
  let alpha = false
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) {
      alpha = true
      break
    }
  }

  const big = canvas(w * 4, h * 4)
  const bctx = big.getContext("2d")
  const tile = model.backend === "webgpu" ? 256 : 128
  const pad = 10
  const tiles = []
  for (let ty = 0; ty < h; ty += tile) for (let tx = 0; tx < w; tx += tile) tiles.push([tx, ty])
  const started = performance.now()
  for (let t = 0; t < tiles.length; t++) {
    if (signal?.aborted) throw aborted()
    const [tx, ty] = tiles[t]
    const x0 = Math.max(0, tx - pad)
    const y0 = Math.max(0, ty - pad)
    const x1 = Math.min(w, tx + tile + pad)
    const y1 = Math.min(h, ty + tile + pad)
    const tw = x1 - x0
    const th = y1 - y0
    const n = tw * th
    const x = new Float32Array(3 * n)
    for (let yy = 0; yy < th; yy++) {
      for (let xx = 0; xx < tw; xx++) {
        const i = yy * tw + xx
        const p = ((y0 + yy) * w + x0 + xx) * 4
        x[i] = pixels[p] / 255
        x[i + n] = pixels[p + 1] / 255
        x[i + 2 * n] = pixels[p + 2] / 255
      }
    }
    const out = await infer(model, { image: new model.lib.Tensor("float32", x, [1, 3, th, tw]) })
    const y = out.upscaled.data
    // Keep the tile's centre; the padding only gives the model context.
    const cx = (tx - x0) * 4
    const cy = (ty - y0) * 4
    const cw = Math.min(tile, w - tx) * 4
    const ch = Math.min(tile, h - ty) * 4
    const OW = tw * 4
    const ON = OW * th * 4
    const part = new ImageData(cw, ch)
    for (let yy = 0; yy < ch; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        const i = (cy + yy) * OW + cx + xx
        const o = (yy * cw + xx) * 4
        part.data[o] = y[i] * 255
        part.data[o + 1] = y[i + ON] * 255
        part.data[o + 2] = y[i + 2 * ON] * 255
        part.data[o + 3] = 255
      }
    }
    out.upscaled.dispose?.()
    bctx.putImageData(part, tx * 4, ty * 4)
    const done = (t + 1) / tiles.length
    const left = ((performance.now() - started) / (t + 1)) * (tiles.length - t - 1)
    onProgress(0.08 + done * 0.88, t === 0 && tiles.length > 1 ? "Enlarging" : `Enlarging · ${left > 1500 ? `about ${Math.ceil(left / 1000)} s left` : "almost done"}`)
  }

  const result = canvas(W, H)
  const rctx = result.getContext("2d")
  rctx.imageSmoothingQuality = "high"
  rctx.drawImage(big, 0, 0, W, H)
  if (alpha) {
    // The model enlarges colour; transparency is scaled smoothly alongside it.
    const a = canvas(W, H)
    const actx = a.getContext("2d")
    actx.imageSmoothingQuality = "high"
    actx.drawImage(img, 0, 0, W, H)
    rctx.globalCompositeOperation = "destination-in"
    rctx.drawImage(a, 0, 0)
  }
  const type = alpha ? "image/png" : "image/jpeg"
  const blob = await new Promise((ok) => result.toBlob(ok, type, 0.93))
  return { blob, mime: type, ext: alpha ? "png" : "jpg", width: W, height: H, model: "Real-ESRGAN, in your browser" }
}
