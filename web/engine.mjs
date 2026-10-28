// Kino on the web: the real interface, with the server replaced by this file.
// It answers the same /api routes in the page, so every screen works as it
// does in the studio. Ad scripts, compliance and recipes use the server's own
// modules; camera moves, reframing and the ad edit render on a canvas;
// background removal and photo upscaling run real models on the visitor's
// device (ai.mjs). With the visitor's own fal.ai key (cloud.mjs) the
// generative apps run for real on fal; without one, their results are
// stand-ins and say so. The library, jobs, ads and recipe runs are kept in this
// browser (keep.mjs), and nothing is uploaded except, with a key, the files a
// job sends to fal.

import { ruleEnhance, imagePrompt, wanPrompt, talkingPrompt } from "./lib/prompt.js"
import { audioById, sizeFor } from "./lib/presets.js"
import { Recipes } from "./lib/recipes.js"
import * as C from "./cloud.js"
import * as K from "./keep.js"
import { templateBrief } from "./lib/ads/templates.js"
import { checkBrief } from "./lib/ads/compliance.js"
import { normalizeBrief, briefProblems } from "./lib/ads/schema.js"
import { platformById } from "./lib/ads/platforms.js"
import * as R from "./render.js"
import * as AI from "./ai.js"

const SEED = new URL("./seed/", import.meta.url)
const boot = { value: null }
const brands = new Map()
const assets = new Map()
const files = new Map() // asset id -> { blob, poster }: what the browser keeps of each file
const jobs = new Map()
const ads = new Map()
let models = { models: [] }
const listeners = new Set()

const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)))
const send = (type, data) => listeners.forEach((fn) => fn(type, clone(data)))
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const sleep = (ms, signal) =>
  new Promise((ok, no) => {
    const t = setTimeout(ok, ms)
    signal?.addEventListener("abort", () => (clearTimeout(t), no(R.canceled())), { once: true })
  })
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
const FULL = "That needs the full studio. This website runs in your browser; download Kino to connect a GPU and your own workflows."
const TERMINAL = new Set(["done", "failed", "canceled"])

// ---------------------------------------------------------------- seed

async function load() {
  const get = async (path) => (await fetch(new URL(path, SEED))).json()
  const [b, state, m] = await Promise.all([get("bootstrap.json"), get("state.json"), get("models.json").catch(() => ({ models: [] }))])
  boot.value = b
  models = m
  b.web = { ...b.web, local: await localApps() }
  for (const brand of await Promise.all(b.ads.brands.map((x) => get(`brands/${x.id}.json`)))) brands.set(brand.id, brand)
  // The seed was made earlier; show it as made a few minutes ago.
  const newest = Math.max(...state.assets.map((a) => a.createdAt), ...state.ads.map((a) => a.createdAt))
  const shift = Date.now() - 8 * 60_000 - newest
  const abs = (u) => (u ? new URL(u, SEED).href : u)
  for (const a of state.assets) assets.set(a.id, { ...a, url: abs(a.url), thumbUrl: abs(a.thumbUrl), createdAt: a.createdAt + shift })
  for (const ad of state.ads) ads.set(ad.id, { ...ad, createdAt: ad.createdAt + shift })
  applyCloud(b)
  await restore()
  await initRecipes(await get("recipes.json").catch(() => []))
}
const ready = load()

/** With a fal.ai key the generative apps are real: the interface says so everywhere it looks. */
function applyCloud(b) {
  const on = !!C.cloudKey()
  b.web = { ...b.web, cloud: on, recipes: true, keeps: true }
  if (!on) return
  b.provider = { id: "fal", label: "fal.ai · your key", web: true }
  for (const app of b.apps) {
    if (!C.ENDPOINTS[app.id]) continue
    app.model = C.ENDPOINTS[app.id].model
    b.web.local[app.id] = { note: "", cloud: true }
  }
}

/** What this browser kept from earlier visits; anything cut off mid-way is marked so. */
async function restore() {
  const [keptAssets, keptJobs, keptAds] = await Promise.all([K.all("assets"), K.all("jobs"), K.all("ads")])
  for (const { blob, poster, ...meta } of keptAssets) {
    if (!blob) continue
    const url = URL.createObjectURL(blob)
    files.set(meta.id, { blob, poster: poster ?? null })
    assets.set(meta.id, { ...meta, url, thumbUrl: poster ? URL.createObjectURL(poster) : meta.kind === "image" ? url : null })
  }
  const cut = "The page closed before it finished. Try again."
  keptJobs.sort((a, b) => b.createdAt - a.createdAt)
  for (const job of keptJobs.slice(0, 300)) jobs.set(job.id, TERMINAL.has(job.status) ? job : { ...job, status: "failed", message: "Failed", error: cut })
  for (const job of keptJobs.slice(300)) K.remove("jobs", job.id)
  for (const ad of keptAds) ads.set(ad.id, ad.status === "making" || ad.status === "rendering" ? { ...ad, status: "failed", error: cut } : ad)
  if (keptAssets.length) K.persist()
}

// Apps that run for real here, for the interface to say so.
async function localApps() {
  const local = { "video-instant": { note: "" } }
  const sizes = await AI.models().catch(() => null)
  if (sizes?.cutout) local.cutout = { note: `IS-Net downloads once (${Math.round(sizes.cutout.bytes / 1e6)} MB).` }
  if (sizes?.upscale) local["upscale-image"] = { note: `Real-ESRGAN downloads once (${Math.round(sizes.upscale.bytes / 1e6)} MB).` }
  return local
}

// ---------------------------------------------------------------- views

function brandView(b) {
  return { id: b.id, name: b.name, product: b.product, colors: b.colors, offer: b.offer, cta: b.cta, claims: b.claims, banned: b.banned, audience: b.audience, voice: b.voice }
}
const runsHere = (appId) => !!boot.value.web?.local?.[appId]
const brandAsset = (brandId, kind) => [...assets.values()].find((a) => a.brandImage === `${brandId}:${kind}`)
const appById = (id) => boot.value.apps.find((a) => a.id === id)

function listAssets(q) {
  const source = q.get("source") || undefined
  const kind = q.get("kind") || undefined
  const text = (q.get("q") || "").toLowerCase()
  const limit = Number(q.get("limit")) || 120
  return [...assets.values()]
    .filter((a) => (source ? a.source === source : a.source !== "ad-part" && a.source !== "recipe-part"))
    .filter((a) => !kind || a.kind === kind)
    .filter((a) => q.get("favorite") !== "1" || a.favorite)
    .filter((a) => !text || `${a.prompt ?? ""} ${a.name ?? ""}`.toLowerCase().includes(text))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

/** What the browser keeps of an asset: everything but its page-only URLs, plus the files. */
function keepAsset(a) {
  const f = files.get(a.id)
  if (f) K.put("assets", { ...a, url: null, thumbUrl: null, blob: f.blob, poster: f.poster })
}

function addAsset(out, meta) {
  const id = newId("a")
  const url = URL.createObjectURL(out.blob)
  const kind = out.mime.split("/")[0] === "audio" ? "audio" : out.mime.startsWith("video") ? "video" : "image"
  const asset = {
    id,
    kind,
    mime: out.mime,
    file: `${id}.${out.ext}`,
    name: out.name ?? "",
    url,
    thumbUrl: out.poster ? URL.createObjectURL(out.poster) : kind === "image" ? url : null,
    width: out.width ?? 0,
    height: out.height ?? 0,
    duration: out.duration ?? 0,
    bytes: out.blob.size,
    hasAudio: !!out.hasAudio,
    createdAt: Date.now(),
    favorite: false,
    ...meta,
  }
  assets.set(id, asset)
  files.set(id, { blob: out.blob, poster: out.poster ?? null })
  keepAsset(asset)
  send("asset", asset)
  return asset
}

// ---------------------------------------------------------------- uploads

async function upload(file, onProgress = () => {}) {
  await ready
  for (const p of [0.35, 0.7, 1]) {
    onProgress(p)
    await sleep(70)
  }
  const kind = file.type.split("/")[0]
  if (!["image", "video", "audio"].includes(kind)) throw new HttpError(400, "Kino takes photos, videos and audio.")
  const url = URL.createObjectURL(file)
  const meta = await probe(url, kind)
  const out = { blob: file, mime: file.type, ext: (file.name.split(".").pop() || kind).toLowerCase(), name: file.name, ...meta }
  const asset = addAsset(out, { source: "upload" })
  URL.revokeObjectURL(url)
  return clone(asset)
}

function probe(url, kind) {
  return new Promise((resolve) => {
    if (kind === "image") {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => resolve({})
      img.src = url
      return
    }
    const el = document.createElement(kind === "video" ? "video" : "audio")
    el.preload = "metadata"
    el.onloadedmetadata = () => resolve({ width: el.videoWidth || 0, height: el.videoHeight || 0, duration: Number.isFinite(el.duration) ? el.duration : 0, hasAudio: kind === "audio" })
    el.onerror = () => resolve({})
    el.src = url
  })
}

// ---------------------------------------------------------------- jobs

const queue = []
const running = new Map() // job id -> { job, controller, lane }
// Work on the page (canvas, in-browser models) goes one at a time; fal runs several at once.
const LANES = { page: 1, cloud: 4 }
const laneOf = (job) => (C.cloudKey() && C.ENDPOINTS[job.appId] ? "cloud" : "page")

function enqueue({ appId, values = {}, count = 1, meta = {} }) {
  const app = appId === "ad-render" ? { id: "ad-render", tool: "ad", label: "Ad edit", model: "Kino editor", output: "video", seconds: 20, params: [] } : appById(appId)
  if (!app) throw new HttpError(400, `There's no app called ${appId}.`)
  const v = { ...values }
  for (const p of app.params ?? []) if (v[p.id] === undefined && p.default !== undefined) v[p.id] = p.default
  for (const p of app.params ?? []) {
    if (["image", "audio", "video"].includes(p.type) && p.required && !v[p.id]) throw new HttpError(400, `${p.label} is required.`)
    if (["image", "audio", "video"].includes(p.type) && v[p.id] && !assets.has(v[p.id])) throw new HttpError(400, `That ${p.type} is gone from the library.`)
  }
  const n = Math.max(1, Math.min(4, Number(count) || 1))
  const batch = n > 1 ? newId("b") : null
  const out = []
  for (let i = 0; i < n; i++) {
    const job = { id: newId("j"), appId: app.id, tool: app.tool, appLabel: app.label, model: app.model, output: app.output, values: i ? { ...v, seed: (v.seed ?? 0) + i } : v, status: "queued", progress: 0, message: "Queued", batch, index: i, estimate: app.seconds, createdAt: Date.now() + i, ...meta }
    jobs.set(job.id, job)
    queue.push(job.id)
    send("job", job)
    out.push(job)
  }
  pump()
  return out
}

function update(job, changes) {
  Object.assign(job, changes)
  if (TERMINAL.has(job.status)) K.put("jobs", job)
  send("job", job)
}

const lastSent = new Map()
function progress(job, p, message) {
  job.progress = Math.max(job.progress ?? 0, Math.min(0.99, p))
  if (message) job.message = message
  const now = Date.now()
  if (now - (lastSent.get(job.id) ?? 0) > 180) {
    lastSent.set(job.id, now)
    send("job", job)
  }
}

/** Start every queued job whose lane has room. */
function pump() {
  for (const id of [...queue]) {
    const job = jobs.get(id)
    if (job?.status === "queued") {
      const lane = laneOf(job)
      if ([...running.values()].filter((r) => r.lane === lane).length >= LANES[lane]) continue
      start(job, lane)
    }
    queue.splice(queue.indexOf(id), 1)
  }
}

async function start(job, lane) {
  const controller = new AbortController()
  running.set(job.id, { job, controller, lane })
  update(job, { status: "running", startedAt: Date.now(), progress: 0.01, message: "Starting", provider: lane === "cloud" ? "fal" : "web" })
  try {
    const outputs = await run(job, controller.signal)
    const parents = ["image", "image2", "endImage", "audio", "video", "media"].map((k) => job.values[k]).filter((x) => x && assets.has(x))
    const made = outputs.map((o) =>
      addAsset(o, {
        source: job.source ?? "generated",
        jobId: job.id,
        appId: job.appId,
        tool: job.tool,
        model: o.model ?? job.model,
        prompt: job.values.prompt ?? "",
        values: job.values,
        parents,
        demo: !o.real,
        ...(job.note ? { note: job.note } : {}),
        ...(job.adId ? { adId: job.adId } : {}),
      }),
    )
    update(job, { status: "done", progress: 1, message: "Done", outputs: made.map((a) => a.id), finishedAt: Date.now() })
  } catch (e) {
    if (e.canceled || controller.signal.aborted) update(job, { status: "canceled", message: "Canceled", finishedAt: Date.now() })
    else update(job, { status: "failed", message: "Failed", error: e.message, finishedAt: Date.now() })
  } finally {
    running.delete(job.id)
    lastSent.delete(job.id)
    onJobFinished(job)
    pump()
  }
}

const src = (id) => assets.get(id)?.url

// A short, honest "model" phase for apps that need a GPU in the real studio.
async function modelPhase(job, signal, seconds = 1.6) {
  const steps = 8
  for (let i = 1; i <= steps; i++) {
    progress(job, (i / steps) * 0.6, i < 3 ? "Demo: the model runs in the full studio" : "Making a stand-in")
    await sleep((seconds * 1000) / steps, signal)
  }
}

async function run(job, signal) {
  if (laneOf(job) === "cloud") return runCloud(job, signal)
  const v = job.values
  const onProgress = (p) => progress(job, 0.6 + p * 0.39, "Rendering in your browser")
  switch (job.appId) {
    case "reframe": {
      progress(job, 0.4, "Reframing")
      const transparent = /png|webp/.test(assets.get(v.image)?.mime ?? "")
      return [{ ...(await R.reframe({ image: src(v.image), aspect: v.aspect, fit: v.fit, transparent })), real: true }]
    }
    case "image-fast":
    case "image-pro": {
      if (job.stage === "still") {
        progress(job, 0.5, "Sketching the scene")
        await sleep(350, signal)
        return [await R.sceneStill({ text: job.visual ?? v.prompt, aspect: v.aspect, seed: job.index })]
      }
      await modelPhase(job, signal)
      return [await R.textImage(v)]
    }
    case "edit": {
      const placing = /^Place this product/i.test(v.prompt ?? "")
      const source = assets.get(v.image)
      if (!placing) {
        await modelPhase(job, signal)
        return [await R.gradeImage({ image: source.url, prompt: v.prompt })]
      }
      // The product is real (the brand's cut-out, or one made here); the set is a stand-in.
      const brand = source?.brandImage?.split(":")[0]
      const cut = brand ? brandAsset(brand, "cutout") : null
      let product = cut?.url
      const img = product ? null : await R.loadImage(source.url)
      const already = img && (await AI.trimmed(img))
      if (already) product = URL.createObjectURL(already.blob)
      if (!product) {
        const made = runsHere("cutout") && (await tryModel(job, signal, async () => {
          const out = await AI.cutout(img, { crop: true, signal, onProgress: (p, msg) => progress(job, p * 0.8, msg) })
          return out.empty ? null : out
        }))
        product = made ? URL.createObjectURL(made.blob) : source.url
      } else await modelPhase(job, signal)
      progress(job, 0.85, "Setting the scene")
      return [await R.productScene({ product, prompt: v.prompt })]
    }
    case "cutout": {
      const source = assets.get(v.image)
      const made = runsHere("cutout") && (await tryModel(job, signal, async () => AI.cutout(await R.loadImage(source.url), { signal, onProgress: (p, msg) => progress(job, p, msg) })))
      if (made) return [{ ...made, real: true }]
      await modelPhase(job, signal, 1)
      return [await R.softCutout({ image: source.url })]
    }
    case "upscale-image": {
      const factor = v.scale === "4x" ? 4 : 2
      const made = runsHere("upscale-image") && (await tryModel(job, signal, async () => AI.upscale(await R.loadImage(src(v.image)), { factor, signal, onProgress: (p, msg) => progress(job, p, msg) })))
      if (made) return [{ ...made, real: true }]
      await modelPhase(job, signal, 1.2)
      return [await R.upscale({ image: src(v.image), scale: v.scale })]
    }
    case "video-instant":
      return [{ ...(await R.cameraMove({ image: src(v.image), camera: v.camera, aspect: v.aspect, duration: v.duration, onProgress: (p) => progress(job, p * 0.99, "Moving the camera"), signal })), real: true }]
    case "video-pro":
    case "video-draft":
    case "video-scene": {
      await modelPhase(job, signal, 2)
      let image = v.image ? src(v.image) : null
      if (!image) {
        const still = await R.sceneStill({ text: v.prompt, aspect: v.aspect ?? "16:9" })
        image = URL.createObjectURL(still.blob)
      }
      const a = assets.get(v.image)
      const r = a?.width && a?.height ? a.width / a.height : 1
      const aspect = v.aspect ?? (r > 1.2 ? "16:9" : r < 0.85 ? "9:16" : "1:1")
      return [await R.cameraMove({ image, camera: v.camera, aspect, duration: v.duration, onProgress, signal })]
    }
    case "talk":
      await modelPhase(job, signal, 1.4)
      return [{ ...(await R.talkingPhoto({ image: src(v.image), audio: src(v.audio), duration: v.duration, onProgress, signal })), hasAudio: !!v.audio }]
    case "upscale-video":
    case "smooth": {
      await modelPhase(job, signal, 1.4)
      const source = assets.get(v.video)
      const blob = await (await fetch(source.url)).blob()
      return [{ blob, mime: source.mime, ext: source.file.split(".").pop(), width: source.width, height: source.height, duration: source.duration, poster: source.thumbUrl ? await (await fetch(source.thumbUrl)).blob() : null }]
    }
    case "ad-render": {
      // The edit is real; it's a demo result only if it shows stand-in scenes.
      const ad = ads.get(v.adId)
      return [{ ...(await renderAdJob(job, signal)), real: !ad?.brief.shots.some((s) => s.source === "generate") }]
    }
    default:
      throw new HttpError(400, FULL)
  }
}

// ---------------------------------------------------------------- fal.ai

const helpers = {
  imagePrompt,
  wanPrompt,
  talkingPrompt,
  audioPhrase: (id) => audioById(id)?.phrase,
  size: (aspect, megapixels) => sizeFor(aspect ?? "1:1", megapixels, 64),
  async file(id) {
    const a = assets.get(id)
    if (!a) throw new Error("A file this needs was deleted from the library.")
    const blob = files.get(id)?.blob ?? (await (await fetch(a.url)).blob())
    if (blob.size > 30e6) throw new Error(`That ${a.kind} is over 30 MB, too big to send from the website. The desktop app takes it.`)
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
  },
}

/** A generative app on fal.ai with the visitor's key; the results come back into the library. */
async function runCloud(job, signal) {
  // An ad's scene is its shot description, in the ad's shape.
  const values = job.stage === "still" ? { ...job.values, prompt: job.visual ?? job.values.prompt } : job.values
  const begun = Date.now()
  const expected = Math.max(10, job.estimate || 30) * 1000
  const out = await C.runOnFal({
    appId: job.appId,
    values,
    key: C.cloudKey(),
    h: helpers,
    signal,
    onProgress: (message) => progress(job, 0.04 + 0.86 * Math.min(0.97, (Date.now() - begun) / expected), message),
  })
  if (!out.files.length) throw new Error("fal.ai finished but sent nothing back.")
  progress(job, 0.92, "Bringing it back")
  return Promise.all(out.files.map((f) => fetched(f, out, signal)))
}

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/wav": "wav" }

async function fetched(f, { model, sound }, signal) {
  let res
  try {
    res = await fetch(f.url, { signal })
  } catch (e) {
    if (signal.aborted) throw R.canceled()
    throw new Error(`Couldn't bring the result back from fal.ai (${e.message}).`)
  }
  if (!res.ok) throw new Error(`Couldn't bring the result back from fal.ai (${res.status}).`)
  const blob = await res.blob()
  const mime = blob.type && blob.type !== "application/octet-stream" ? blob.type : (f.mime ?? "image/png")
  const kind = mime.startsWith("video") ? "video" : mime.startsWith("audio") ? "audio" : "image"
  const url = URL.createObjectURL(blob)
  const meta = await probe(url, kind)
  const poster = kind === "video" ? await R.posterOf(url) : null
  URL.revokeObjectURL(url)
  return { blob, mime, ext: EXT[mime] ?? mime.split("/")[1] ?? "bin", ...meta, poster, model, real: true, hasAudio: kind === "video" && sound }
}

/**
 * Run one of the in-browser models. If this browser can't (no WebAssembly,
 * not enough memory, the model didn't download), the job carries on with a
 * stand-in, labelled as one, and says why.
 */
async function tryModel(job, signal, fn) {
  try {
    return await fn()
  } catch (e) {
    if (e.canceled || signal.aborted) throw R.canceled()
    console.warn("[kino] in-browser model failed, making a stand-in:", e)
    job.note = `This browser couldn't run the model (${e.message || e}), so this is a stand-in.`
    progress(job, 0.5, "Making a stand-in instead")
    return null
  }
}

function cancel(id) {
  const job = jobs.get(id)
  if (!job) return { ok: false }
  if (job.status === "queued") update(job, { status: "canceled", message: "Canceled", finishedAt: Date.now() })
  else running.get(id)?.controller.abort()
  return clone(job)
}

// ---------------------------------------------------------------- ads

function emitAd(ad) {
  K.put("ads", ad)
  send("ad", ad)
}

function createAd({ brandId, brief, engine = "instant", productAssetId }) {
  const brand = brands.get(brandId)
  if (!brand) throw new HttpError(400, "Pick a brand first.")
  const id = newId("ad")
  const clean = normalizeBrief(brief, { brandId, id })
  const ad = {
    id,
    brandId,
    engine: ["instant", "pro", "draft"].includes(engine) ? engine : "instant",
    productAssetId: productAssetId ?? brandAsset(brandId, "photo")?.id ?? null,
    cutoutAssetId: brandAsset(brandId, "cutout")?.id ?? null,
    musicAssetId: null,
    brief: clean,
    issues: checkBrief(clean, brand),
    status: "draft",
    shots: {},
    renders: [],
    createdAt: Date.now(),
  }
  ads.set(id, ad)
  emitAd(ad)
  return clone(ad)
}

const sameShot = (a, b) => a.source === b.source && a.visual === b.visual && a.camera === b.camera && a.seconds === b.seconds

function updateAd(id, { brief, engine }) {
  const ad = ads.get(id)
  if (!ad) throw new HttpError(404, "That ad is gone.")
  if (ad.status === "making") throw new HttpError(400, "Wait for the shots to finish before editing.")
  if (brief) {
    const clean = normalizeBrief(brief, { brandId: ad.brandId, id })
    const keep = {}
    for (const s of clean.shots) {
      const before = ad.brief.shots.find((x) => x.id === s.id)
      if (before && ad.shots[s.id] && sameShot(before, s)) keep[s.id] = ad.shots[s.id]
    }
    Object.assign(ad, { brief: clean, shots: keep, issues: checkBrief(clean, brands.get(ad.brandId)), status: "draft" })
  }
  if (engine && engine !== ad.engine) Object.assign(ad, { engine, shots: {}, status: "draft" })
  emitAd(ad)
  return clone(ad)
}

function makeAd(id, { acceptWarnings = false } = {}) {
  const ad = ads.get(id)
  if (!ad) throw new HttpError(404, "That ad is gone.")
  const problems = briefProblems(ad.brief)
  if (problems.length) throw new HttpError(400, problems.join(" "))
  const blocking = ad.issues.filter((i) => i.severity === "block")
  if (blocking.length && !acceptWarnings) throw new HttpError(409, `${blocking.length} compliance issue${blocking.length > 1 ? "s" : ""} would likely get this ad rejected. Fix them, or confirm to make it anyway.`)
  ad.status = "making"
  ad.error = null
  for (const shot of ad.brief.shots) {
    const st = ad.shots[shot.id]
    if (st?.clipAssetId && assets.has(st.clipAssetId)) continue
    ad.shots[shot.id] = queueShot(ad, shot)
  }
  emitAd(ad)
  maybeRender(ad)
  return clone(ad)
}

// In the web demo each shot is a still (the product photo, or a stand-in for a
// generated scene); the edit moves the camera over it.
function queueShot(ad, shot) {
  const n = ad.brief.shots.indexOf(shot) + 1
  const meta = { source: "ad-part", adId: ad.id, shotId: shot.id, stage: "still", label: `${ad.brief.title} · shot ${n}`, visual: shot.visual }
  if (shot.source === "product-photo") return { status: "done", clipAssetId: ad.productAssetId }
  const job = enqueue({ appId: "image-fast", values: { prompt: shot.visual, aspect: ad.brief.aspect === "4:5" ? "4:5" : ad.brief.aspect === "1:1" ? "1:1" : "9:16" }, meta })[0]
  return { status: "making", stillJob: job.id }
}

function retryShot(id, shotId) {
  const ad = ads.get(id)
  const shot = ad?.brief.shots.find((s) => s.id === shotId)
  if (!shot) throw new HttpError(404, "That shot is gone.")
  ad.shots[shotId] = queueShot(ad, shot)
  ad.status = "making"
  emitAd(ad)
  maybeRender(ad)
  return clone(ad)
}

function onJobFinished(job) {
  if (job.runId) for (const fn of finishHooks) fn(job)
  if (!job.adId) return
  const ad = ads.get(job.adId)
  if (!ad) return
  if (job.stage === "render") {
    const r = ad.renders.find((x) => x.jobId === job.id)
    if (r) Object.assign(r, { status: job.status, assetId: job.outputs?.[0] ?? null, error: job.error ?? null })
    const ok = job.status === "done"
    Object.assign(ad, { status: ok ? "done" : ad.status === "rendering" ? "failed" : ad.status, error: ok ? null : job.error ?? null, outputAssetId: ok ? job.outputs[0] : ad.outputAssetId })
    emitAd(ad)
    return
  }
  const st = ad.shots[job.shotId]
  if (!st || st.stillJob !== job.id) return
  if (job.status !== "done") {
    Object.assign(st, { status: job.status === "canceled" ? "canceled" : "failed", error: job.error ?? "Canceled" })
    Object.assign(ad, { status: "failed", error: `Shot ${ad.brief.shots.findIndex((s) => s.id === job.shotId) + 1}: ${st.error}` })
    emitAd(ad)
    return
  }
  Object.assign(st, { status: "done", stillAssetId: job.outputs[0], clipAssetId: job.outputs[0] })
  emitAd(ad)
  maybeRender(ad)
}

function maybeRender(ad) {
  if (ad.status === "making" && ad.brief.shots.every((s) => ad.shots[s.id]?.status === "done")) renderAd(ad.id)
}

function renderAd(id, { platform } = {}) {
  const ad = ads.get(id)
  if (!ad) throw new HttpError(404, "That ad is gone.")
  if (!ad.brief.shots.every((s) => ad.shots[s.id]?.status === "done")) throw new HttpError(400, "Make the shots first.")
  const p = platformById(platform ?? ad.brief.platform)
  const job = enqueue({ appId: "ad-render", values: { adId: ad.id, platform: p.id }, meta: { source: "ad", adId: ad.id, stage: "render", label: `${ad.brief.title} · ${p.label}` } })[0]
  ad.renders.push({ jobId: job.id, platform: p.id, status: "queued", createdAt: Date.now() })
  ad.status = "rendering"
  emitAd(ad)
  return clone(ad)
}

async function renderAdJob(job, signal) {
  const ad = ads.get(job.values.adId)
  if (!ad) throw new Error("That ad is gone.")
  const brand = brands.get(ad.brandId)
  const clips = await Promise.all(
    ad.brief.shots.map(async (s) => {
      const url = src(ad.shots[s.id]?.clipAssetId)
      if (url) return url
      if (s.source !== "generate") throw new Error("A shot's picture was deleted from the library. Make it again.")
      // Seeded ads keep no scene stills; a stand-in is drawn when they're re-cut.
      return URL.createObjectURL((await R.sceneStill({ text: s.visual, aspect: ad.brief.aspect })).blob)
    }),
  )
  const cutout = src(ad.cutoutAssetId) ?? src(ad.productAssetId)
  progress(job, 0.02, "Editing the final cut")
  return R.renderAd({ brief: ad.brief, brand, clips, cutout, platform: job.values.platform, signal, onProgress: (p) => progress(job, p * 0.98, "Editing the final cut") })
}

function removeAd(id) {
  if (!ads.delete(id)) return { ok: false }
  K.remove("ads", id)
  send("ad-removed", { id })
  return { ok: true }
}

async function draft({ brandId, platform = "tiktok", language = "zh", angles = ["ritual"] }) {
  const brand = brands.get(brandId)
  if (!brand) throw new HttpError(400, "Pick a brand first.")
  await sleep(650)
  const wanted = angles.filter((a) => boot.value.ads.angles[a]).slice(0, 3)
  if (!wanted.length) wanted.push("ritual")
  const briefs = wanted.map((angle) => templateBrief({ brand, platform: platformById(platform).id, language, angle }))
  return { source: "templates", briefs: briefs.map((b) => ({ ...b, issues: checkBrief(b, brand) })) }
}

function saveBrand(id, changes) {
  const brand = brands.get(id)
  if (!brand) throw new HttpError(404, "That brand is gone.")
  for (const k of ["name", "product", "audience", "voice", "colors", "offer", "cta", "claims", "story", "moments", "banned", "rules"]) if (changes?.[k] !== undefined) brand[k] = changes[k]
  const view = brandView(brand)
  boot.value.ads.brands = boot.value.ads.brands.map((b) => (b.id === id ? view : b))
  return view
}

// ---------------------------------------------------------------- recipes

// The studio's own recipe engine (lib/recipes.js), with its runs and imported
// recipes kept in this browser.
const kept = { recipes: new Map(), runs: new Map() }
const recipeStore = {
  list: (c, filter) => [...kept[c].values()].filter((r) => !filter || filter(r)),
  get: (c, id) => kept[c].get(id) ?? null,
  put: (c, row) => (kept[c].set(row.id, row), K.put(c, row), row),
  remove(c, id) {
    const had = kept[c].delete(id)
    if (had) K.remove(c, id)
    return had
  },
}
const finishHooks = new Set()
let recipes = null

async function initRecipes(builtin) {
  for (const c of ["recipes", "runs"]) {
    for (const row of await K.all(c)) kept[c].set(row.id, c === "runs" && row.status === "running" ? { ...row, status: "failed", error: "The page closed before it finished." } : row)
  }
  try {
    recipes = new Recipes({
      store: recipeStore,
      apps: { get: (id) => appById(id) },
      jobs: { enqueue, get: (id) => jobs.get(id), cancel },
      library: { get: (id) => assets.get(id) },
      events: { on: (type, fn) => type === "job-finished" && finishHooks.add(fn), emit: (type, data) => send(type, data) },
      builtin,
    })
  } catch (e) {
    console.warn("[kino] recipes are off:", e.message)
  }
}

function useRecipes() {
  if (!recipes) throw new HttpError(400, FULL)
  return recipes
}

/** The engine's own errors are a 400 with its sentence, as the server sends them. */
function plain(fn) {
  try {
    return fn()
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, e.message)
  }
}

// A run's results as one zip, made in the page: stored entries (pictures and
// videos are compressed already), plus kino.json of how each was made.
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes) => {
  let c = ~0 >>> 0
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

async function zipBlob(entries) {
  const enc = new TextEncoder()
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = (Math.max(0, now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const parts = []
  const central = []
  const seen = new Map()
  let offset = 0
  for (const e of entries) {
    const n = (seen.get(e.name) ?? 0) + 1
    seen.set(e.name, n)
    const name = enc.encode(n > 1 ? e.name.replace(/(\.[^.]+)?$/, `-${n}$1`) : e.name)
    const data = new Uint8Array(await e.blob.arrayBuffer())
    const crc = crc32(data)
    const head = new DataView(new ArrayBuffer(30))
    for (const [at, v, size] of [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2]]) size === 4 ? head.setUint32(at, v, true) : head.setUint16(at, v, true)
    parts.push(head, name, data)
    central.push({ name, crc, size: data.length, offset })
    offset += 30 + name.length + data.length
  }
  let directory = 0
  for (const c of central) {
    const head = new DataView(new ArrayBuffer(46))
    for (const [at, v, size] of [[0, 0x02014b50, 4], [4, 0x0314, 2], [6, 20, 2], [8, 0x0800, 2], [12, time, 2], [14, date, 2], [16, c.crc, 4], [20, c.size, 4], [24, c.size, 4], [28, c.name.length, 2], [38, (0o100644 << 16) >>> 0, 4], [42, c.offset, 4]]) size === 4 ? head.setUint32(at, v, true) : head.setUint16(at, v, true)
    parts.push(head, c.name)
    directory += 46 + c.name.length
  }
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, central.length, true)
  end.setUint16(10, central.length, true)
  end.setUint32(12, directory, true)
  end.setUint32(16, offset, true)
  parts.push(end)
  return new Blob(parts, { type: "application/zip" })
}

async function zipRun(id) {
  const run = useRecipes().getRun(id)
  if (!run) throw new HttpError(404, "That run is gone.")
  const entries = []
  const made = []
  for (const s of run.recipe.steps) {
    if (s.keep === false) continue
    const outs = run.steps[s.id].outputs.map((x) => assets.get(x)).filter(Boolean)
    for (const [i, a] of outs.entries()) {
      const name = `${(s.label ?? s.id).replace(/[\\/:*?"<>|]+/g, "-")}${outs.length > 1 ? ` ${i + 1}` : ""}.${a.file.split(".").pop()}`
      entries.push({ name, blob: files.get(a.id)?.blob ?? (await (await fetch(a.url)).blob()) })
      made.push({ file: name, step: s.label ?? s.id, app: a.appId, model: a.model, prompt: a.prompt || undefined, width: a.width, height: a.height })
    }
  }
  if (!entries.length) throw new HttpError(400, "This run has nothing to download yet.")
  const words = Object.fromEntries(Object.entries(run.inputs).filter(([, v]) => typeof v === "string" && !assets.has(v)))
  entries.push({ name: "kino.json", blob: new Blob([JSON.stringify({ kino: "run/1", recipe: run.recipeId, title: run.title, made: new Date(run.createdAt).toISOString(), inputs: words, files: made }, null, 2) + "\n"]) })
  return { blob: await zipBlob(entries), name: `${run.title} ${new Date(run.createdAt).toISOString().slice(0, 10)}.zip` }
}

// ---------------------------------------------------------------- routes

const ROUTES = [
  ["GET", /^\/api\/bootstrap$/, () => boot.value],
  ["GET", /^\/api\/status$/, () => ({ ok: true, label: C.cloudKey() ? "Kino on the web: AI on fal.ai with your key" : "Web demo: everything runs in your browser", apps: {} })],
  ["GET", /^\/api\/assets$/, (m, q) => listAssets(q)],
  ["PATCH", /^\/api\/assets\/([^/]+)$/, ([, id], q, body) => {
    const a = assets.get(id)
    if (!a) throw new HttpError(404, "That file is gone.")
    for (const k of ["favorite", "name"]) if (body?.[k] !== undefined) a[k] = body[k]
    keepAsset(a)
    send("asset", a)
    return a
  }],
  ["DELETE", /^\/api\/assets\/([^/]+)$/, ([, id]) => {
    const ok = assets.delete(id)
    if (ok) (files.delete(id), K.remove("assets", id), send("asset-removed", { id }))
    return { ok }
  }],
  ["GET", /^\/api\/jobs$/, () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200)],
  ["POST", /^\/api\/generate$/, (m, q, b) => ({ jobs: enqueue({ appId: b.app, values: b.values, count: b.count }) })],
  ["POST", /^\/api\/jobs\/([^/]+)\/cancel$/, ([, id]) => cancel(id)],
  ["POST", /^\/api\/jobs\/([^/]+)\/retry$/, ([, id]) => {
    const old = jobs.get(id)
    if (!old) throw new HttpError(404, "That job is gone.")
    const meta = Object.fromEntries(["source", "adId", "shotId", "stage", "label", "visual"].filter((k) => old[k] !== undefined).map((k) => [k, old[k]]))
    return enqueue({ appId: old.appId, values: old.values, meta })[0]
  }],
  ["DELETE", /^\/api\/jobs\/([^/]+)$/, ([, id]) => {
    const job = jobs.get(id)
    if (!job || running.has(id)) return { ok: false }
    jobs.delete(id)
    send("job-removed", { id })
    return { ok: true }
  }],
  ["GET", /^\/api\/settings$/, () => boot.value.settings],
  ["PUT", /^\/api\/settings$/, () => {
    throw new HttpError(400, FULL)
  }],
  ["POST", /^\/api\/enhance$/, async (m, q, b) => {
    await sleep(400)
    const kind = ["image", "video", "edit", "talk"].includes(b.tool) ? b.tool : "image"
    return { prompt: ruleEnhance(kind, String(b.prompt ?? "").trim()), source: "rules" }
  }],
  ["POST", /^\/api\/apps\/import$/, () => {
    throw new HttpError(400, FULL)
  }],
  ["DELETE", /^\/api\/apps\/([^/]+)$/, () => ({ ok: false })],
  ["GET", /^\/api\/models$/, () => models],
  ["GET", /^\/api\/brands$/, () => [...brands.values()].map(brandView)],
  ["PUT", /^\/api\/brands\/([^/]+)$/, ([, id], q, b) => saveBrand(id, b)],
  ["GET", /^\/api\/ads$/, () => [...ads.values()].sort((a, b) => b.createdAt - a.createdAt)],
  ["GET", /^\/api\/ads\/([^/]+)$/, ([, id]) => ads.get(id) ?? (() => { throw new HttpError(404, "That ad is gone.") })()],
  ["POST", /^\/api\/ads\/draft$/, (m, q, b) => draft(b)],
  ["POST", /^\/api\/ads$/, (m, q, b) => createAd(b)],
  ["PUT", /^\/api\/ads\/([^/]+)$/, ([, id], q, b) => updateAd(id, b)],
  ["POST", /^\/api\/ads\/([^/]+)\/make$/, ([, id], q, b) => makeAd(id, b)],
  ["POST", /^\/api\/ads\/([^/]+)\/render$/, ([, id], q, b) => renderAd(id, b)],
  ["POST", /^\/api\/ads\/([^/]+)\/shots\/([^/]+)\/retry$/, ([, id, shot]) => retryShot(id, shot)],
  ["DELETE", /^\/api\/ads\/([^/]+)$/, ([, id]) => removeAd(id)],
  ["POST", /^\/api\/login$/, () => ({ ok: true })],
  ["GET", /^\/api\/recipes$/, () => useRecipes().list()],
  ["GET", /^\/api\/recipes\/([^/]+)$/, ([, id]) => useRecipes().get(decodeURIComponent(id)) ?? (() => { throw new HttpError(404, "That recipe is gone.") })()],
  ["POST", /^\/api\/recipes$/, (m, q, b) => plain(() => useRecipes().save(b))],
  ["DELETE", /^\/api\/recipes\/([^/]+)$/, ([, id]) => plain(() => ({ ok: useRecipes().remove(decodeURIComponent(id)) }))],
  ["POST", /^\/api\/recipes\/([^/]+)\/run$/, ([, id], q, b) => plain(() => useRecipes().start(decodeURIComponent(id), b?.inputs ?? {}))],
  ["GET", /^\/api\/runs$/, (m, q) => useRecipes().runs({ recipeId: q.get("recipe") || undefined })],
  ["GET", /^\/api\/runs\/([^/]+)$/, ([, id]) => useRecipes().getRun(id) ?? (() => { throw new HttpError(404, "That run is gone.") })()],
  ["POST", /^\/api\/runs\/([^/]+)\/cancel$/, ([, id]) => plain(() => useRecipes().cancel(id))],
  ["DELETE", /^\/api\/runs\/([^/]+)$/, ([, id]) => ({ ok: useRecipes().removeRun(id) })],
]

async function api(path, { method = "GET", body } = {}) {
  await ready
  const url = new URL(path, location.origin)
  for (const [m, re, fn] of ROUTES) {
    const match = m === method && re.exec(url.pathname)
    if (match) return clone(await fn(match, url.searchParams, body))
  }
  throw new HttpError(404, `The web demo doesn't know ${method} ${url.pathname}.`)
}

window.kinoDemo = {
  api,
  upload,
  device: AI.device,
  subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  // The visitor's fal.ai key: set or forgotten here, it takes effect on reload.
  cloud: { on: () => !!C.cloudKey(), set: (key) => C.setCloudKey(key) },
  zipRun: async (id) => (await ready, zipRun(id)),
}
