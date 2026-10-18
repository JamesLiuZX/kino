// Kino's web demo: the real interface, with the server replaced by this file.
// It answers the same /api routes from memory, so every screen works as it
// does in the studio. Ad scripts and compliance use the server's own modules,
// camera moves and the ad edit render on a canvas, and nothing leaves the
// page: uploads and recordings stay in this tab. The AI models (images, video,
// voice) need the full studio and a GPU, so their results here are stand-ins
// and say so.

import { ruleEnhance } from "./lib/prompt.js"
import { templateBrief } from "./lib/ads/templates.js"
import { checkBrief } from "./lib/ads/compliance.js"
import { normalizeBrief, briefProblems } from "./lib/ads/schema.js"
import { platformById } from "./lib/ads/platforms.js"
import * as R from "./render.js"

const SEED = new URL("./seed/", import.meta.url)
const boot = { value: null }
const brands = new Map()
const assets = new Map()
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
const FULL = "That needs the full studio. This web demo runs in your browser; download Kino to connect a GPU and your own workflows."

// ---------------------------------------------------------------- seed

async function load() {
  const get = async (path) => (await fetch(new URL(path, SEED))).json()
  const [b, state, m] = await Promise.all([get("bootstrap.json"), get("state.json"), get("models.json").catch(() => ({ models: [] }))])
  boot.value = b
  models = m
  for (const brand of await Promise.all(b.ads.brands.map((x) => get(`brands/${x.id}.json`)))) brands.set(brand.id, brand)
  // The seed was made earlier; show it as made a few minutes ago.
  const newest = Math.max(...state.assets.map((a) => a.createdAt), ...state.ads.map((a) => a.createdAt))
  const shift = Date.now() - 8 * 60_000 - newest
  const abs = (u) => (u ? new URL(u, SEED).href : u)
  for (const a of state.assets) assets.set(a.id, { ...a, url: abs(a.url), thumbUrl: abs(a.thumbUrl), createdAt: a.createdAt + shift })
  for (const ad of state.ads) ads.set(ad.id, { ...ad, createdAt: ad.createdAt + shift })
}
const ready = load()

// ---------------------------------------------------------------- views

function brandView(b) {
  return { id: b.id, name: b.name, product: b.product, colors: b.colors, offer: b.offer, cta: b.cta, claims: b.claims, banned: b.banned, audience: b.audience, voice: b.voice }
}
const brandAsset = (brandId, kind) => [...assets.values()].find((a) => a.brandImage === `${brandId}:${kind}`)
const appById = (id) => boot.value.apps.find((a) => a.id === id)

function listAssets(q) {
  const source = q.get("source") || undefined
  const kind = q.get("kind") || undefined
  const text = (q.get("q") || "").toLowerCase()
  const limit = Number(q.get("limit")) || 120
  return [...assets.values()]
    .filter((a) => (source ? a.source === source : a.source !== "ad-part"))
    .filter((a) => !kind || a.kind === kind)
    .filter((a) => q.get("favorite") !== "1" || a.favorite)
    .filter((a) => !text || `${a.prompt ?? ""} ${a.name ?? ""}`.toLowerCase().includes(text))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
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
let running = null

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
  send("job", job)
}

let lastProgress = 0
function progress(job, p, message) {
  job.progress = Math.max(job.progress ?? 0, Math.min(0.99, p))
  if (message) job.message = message
  const now = Date.now()
  if (now - lastProgress > 180) {
    lastProgress = now
    send("job", job)
  }
}

async function pump() {
  if (running) return
  const id = queue.shift()
  if (!id) return
  const job = jobs.get(id)
  if (!job || job.status !== "queued") return pump()
  const controller = new AbortController()
  running = { job, controller }
  update(job, { status: "running", startedAt: Date.now(), progress: 0.01, message: "Starting", provider: "web" })
  try {
    const outputs = await run(job, controller.signal)
    const parents = ["image", "image2", "endImage", "audio", "video", "media"].map((k) => job.values[k]).filter((x) => x && assets.has(x))
    const made = outputs.map((o) =>
      addAsset(o, {
        source: job.source ?? "generated",
        jobId: job.id,
        appId: job.appId,
        tool: job.tool,
        model: job.model,
        prompt: job.values.prompt ?? "",
        values: job.values,
        parents,
        demo: true,
        ...(job.adId ? { adId: job.adId } : {}),
      }),
    )
    update(job, { status: "done", progress: 1, message: "Done", outputs: made.map((a) => a.id), finishedAt: Date.now() })
  } catch (e) {
    if (e.canceled || controller.signal.aborted) update(job, { status: "canceled", message: "Canceled", finishedAt: Date.now() })
    else update(job, { status: "failed", message: "Failed", error: e.message, finishedAt: Date.now() })
  } finally {
    running = null
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
  const v = job.values
  const onProgress = (p) => progress(job, 0.6 + p * 0.39, "Rendering in your browser")
  switch (job.appId) {
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
      await modelPhase(job, signal)
      const placing = /^Place this product/i.test(v.prompt ?? "")
      const source = assets.get(v.image)
      const brand = source?.brandImage?.split(":")[0]
      const cut = brand ? brandAsset(brand, "cutout") : null
      if (placing) return [await R.productScene({ product: cut?.url ?? source.url, prompt: v.prompt })]
      return [await R.gradeImage({ image: source.url, prompt: v.prompt })]
    }
    case "cutout": {
      await modelPhase(job, signal, 1)
      const source = assets.get(v.image)
      const brand = source?.brandImage?.split(":")[0]
      const cut = brand ? brandAsset(brand, "cutout") : null
      if (cut) {
        const blob = await (await fetch(cut.url)).blob()
        return [{ blob, mime: blob.type || "image/webp", ext: cut.file.split(".").pop(), width: cut.width, height: cut.height }]
      }
      return [await R.softCutout({ image: source.url })]
    }
    case "upscale-image":
      await modelPhase(job, signal, 1.2)
      return [await R.upscale({ image: src(v.image), scale: v.scale })]
    case "video-instant":
      return [await R.cameraMove({ image: src(v.image), camera: v.camera, aspect: v.aspect, duration: v.duration, onProgress: (p) => progress(job, p * 0.99, "Moving the camera"), signal })]
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
    case "ad-render":
      return [await renderAdJob(job, signal)]
    default:
      throw new HttpError(400, FULL)
  }
}

function cancel(id) {
  const job = jobs.get(id)
  if (!job) return { ok: false }
  if (job.status === "queued") update(job, { status: "canceled", message: "Canceled", finishedAt: Date.now() })
  else if (running?.job.id === id) running.controller.abort()
  return clone(job)
}

// ---------------------------------------------------------------- ads

function emitAd(ad) {
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

// ---------------------------------------------------------------- routes

const ROUTES = [
  ["GET", /^\/api\/bootstrap$/, () => boot.value],
  ["GET", /^\/api\/status$/, () => ({ ok: true, label: "Web demo: everything runs in your browser", apps: {} })],
  ["GET", /^\/api\/assets$/, (m, q) => listAssets(q)],
  ["PATCH", /^\/api\/assets\/([^/]+)$/, ([, id], q, body) => {
    const a = assets.get(id)
    if (!a) throw new HttpError(404, "That file is gone.")
    for (const k of ["favorite", "name"]) if (body?.[k] !== undefined) a[k] = body[k]
    send("asset", a)
    return a
  }],
  ["DELETE", /^\/api\/assets\/([^/]+)$/, ([, id]) => {
    const ok = assets.delete(id)
    if (ok) send("asset-removed", { id })
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
    if (!job || running?.job.id === id) return { ok: false }
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
  subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
}
