// The Ad Studio: brand profile + product photo + an angle -> scripts -> shots ->
// a finished, captioned ad in the right shape for TikTok or Meta. Each shot is
// an ordinary job (so it shows in the queue, can be retried, and lands in the
// library); the final edit is a local job that waits for them.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { newId } from "../store.mjs"
import { checkBrief } from "./compliance.mjs"
import { platformById } from "./platforms.mjs"
import { renderAd } from "./render.mjs"
import { briefProblems, normalizeBrief } from "./schema.mjs"
import { writeBriefs } from "./writer.mjs"

export const ENGINES = {
  instant: { label: "Instant · free", blurb: "Camera moves on your product photo and on generated stills. Ready in about a minute, no video GPU time." },
  pro: { label: "Pro · with sound", blurb: "MiniMax H3 animates every shot with native sound. Best quality; a few minutes on a 48 GB GPU." },
  draft: { label: "Draft · silent", blurb: "Wan 2.2 on a 24 GB GPU: real motion, no sound, cheaper than Pro." },
}

const ROOT = new URL("../..", import.meta.url).pathname
const BRAND_FIELDS = new Set(["name", "product", "audience", "voice", "colors", "offer", "cta", "claims", "story", "moments", "banned", "rules"])

export class AdStudio {
  constructor({ store, library, jobs, settings, events, brandsDir = join(ROOT, "brands") }) {
    Object.assign(this, { store, library, jobs, settings, events, brandsDir })
    events.on("job-finished", (job) => {
      if (job.adId) this.onJobFinished(job).catch((e) => console.error("[kino] ad step failed:", e))
    })
  }

  // ---------------------------------------------------------------- brands

  brands() {
    const builtin = existsSync(this.brandsDir)
      ? readdirSync(this.brandsDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => JSON.parse(readFileSync(join(this.brandsDir, f), "utf8")))
      : []
    const saved = this.store.list("brands")
    const ids = new Set([...builtin.map((b) => b.id), ...saved.map((b) => b.id)])
    return [...ids].map((id) => this.brand(id)).filter(Boolean)
  }

  brand(id) {
    const file = join(this.brandsDir, `${id}.json`)
    const builtin = /^[a-z0-9-]+$/.test(id) && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null
    const saved = this.store.get("brands", id)
    if (!builtin && !saved) return null
    return { ...(builtin ?? {}), ...(saved ?? {}), id }
  }

  saveBrand(id, changes) {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error("Brand ids are lowercase letters, digits and dashes.")
    const current = this.brand(id) ?? { id, name: id }
    const allowed = Object.fromEntries(Object.entries(changes ?? {}).filter(([k]) => BRAND_FIELDS.has(k)))
    const row = { ...current, ...allowed, id, updatedAt: Date.now() }
    this.store.put("brands", row)
    return row
  }

  /** Brand photos become library assets once, so shots and edits can use them. */
  async brandAssets(brand) {
    const out = {}
    for (const [key, rel] of Object.entries(brand.product?.images ?? {})) {
      const existing = this.store.list("assets", (a) => a.brandImage === `${brand.id}:${key}`)[0]
      if (existing) {
        out[key] = existing.id
        continue
      }
      const path = join(this.brandsDir, rel)
      if (!existsSync(path)) continue
      const asset = await this.library.add({ path, filename: rel.split("/").pop(), mime: mimeOf(rel), source: "brand", brandImage: `${brand.id}:${key}`, name: `${brand.name} · ${key}` })
      out[key] = asset.id
    }
    return out
  }

  // ---------------------------------------------------------------- briefs

  async draft({ brandId, platform, language, angles, notes, productAssetId }) {
    const brand = this.brand(brandId)
    if (!brand) throw new Error("Pick a brand first.")
    const assets = await this.brandAssets(brand)
    const photo = this.library.get(productAssetId ?? assets.photo)
    const productImage = photo?.kind === "image" ? (photo.thumb ? join(this.library.thumbsDir, photo.thumb) : this.library.pathOf(photo)) : null
    const { source, briefs } = await writeBriefs(this.settings, { brand, platform, language, angles, notes, productImage })
    return { source, briefs: briefs.map((b) => ({ ...b, issues: checkBrief(b, brand) })) }
  }

  list() {
    return this.store.list("ads").sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id) {
    return this.store.get("ads", id)
  }

  async create({ brandId, brief, engine = "instant", productAssetId, musicAssetId }) {
    const brand = this.brand(brandId)
    if (!brand) throw new Error("Pick a brand first.")
    const assets = await this.brandAssets(brand)
    const id = newId("ad")
    const clean = normalizeBrief(brief, { brandId, id })
    const ad = {
      id,
      brandId,
      engine: ENGINES[engine] ? engine : "instant",
      productAssetId: productAssetId ?? assets.photo ?? null,
      cutoutAssetId: assets.cutout ?? null,
      musicAssetId: musicAssetId ?? null,
      brief: clean,
      issues: checkBrief(clean, brand),
      status: "draft",
      shots: {},
      renders: [],
      createdAt: Date.now(),
    }
    this.store.put("ads", ad)
    this.emit(ad)
    return ad
  }

  update(id, { brief, engine, productAssetId, musicAssetId }) {
    const ad = this.get(id)
    if (!ad) throw new Error("That ad is gone.")
    if (ad.status === "making") throw new Error("Wait for the shots to finish before editing.")
    const brand = this.brand(ad.brandId)
    const changes = {}
    if (brief) {
      const clean = normalizeBrief(brief, { brandId: ad.brandId, id })
      // Shots whose content changed must be made again.
      const keep = {}
      for (const s of clean.shots) {
        const before = ad.brief.shots.find((x) => x.id === s.id)
        if (before && ad.shots[s.id] && sameShot(before, s)) keep[s.id] = ad.shots[s.id]
      }
      changes.brief = clean
      changes.shots = keep
      changes.issues = checkBrief(clean, brand)
    }
    if (engine && ENGINES[engine] && engine !== ad.engine) {
      changes.engine = engine
      changes.shots = {}
    }
    if (productAssetId !== undefined) changes.productAssetId = productAssetId
    if (musicAssetId !== undefined) changes.musicAssetId = musicAssetId
    if (Object.keys(changes).length) changes.status = "draft"
    this.store.patch("ads", id, changes)
    this.emit(ad)
    return ad
  }

  remove(id) {
    const ad = this.get(id)
    if (!ad) return false
    for (const s of Object.values(ad.shots)) for (const j of [s.stillJob, s.clipJob]) if (j) this.jobs.cancel(j)
    this.store.remove("ads", id)
    this.events.emit("ad-removed", { id })
    return true
  }

  // ---------------------------------------------------------------- making

  /** Queue every shot that isn't made yet; the edit follows automatically. */
  make(id, { acceptWarnings = false } = {}) {
    const ad = this.get(id)
    if (!ad) throw new Error("That ad is gone.")
    const problems = briefProblems(ad.brief)
    if (problems.length) throw new Error(problems.join(" "))
    const blocking = ad.issues.filter((i) => i.severity === "block")
    if (blocking.length && !acceptWarnings) {
      const e = new Error(`${blocking.length} compliance issue${blocking.length > 1 ? "s" : ""} would likely get this ad rejected. Fix them, or confirm to make it anyway.`)
      e.status = 409
      throw e
    }
    if (!ad.productAssetId && ad.brief.shots.some((s) => s.source === "product-photo")) throw new Error("Add a product photo first.")
    ad.status = "making"
    ad.error = null
    for (const shot of ad.brief.shots) {
      const state = ad.shots[shot.id]
      if (state?.clipAssetId && this.library.get(state.clipAssetId)) continue
      ad.shots[shot.id] = this.queueShot(ad, shot)
    }
    this.store.patch("ads", id, { status: ad.status, shots: ad.shots, error: null })
    this.emit(ad)
    this.maybeRender(ad)
    return ad
  }

  retryShot(id, shotId) {
    const ad = this.get(id)
    const shot = ad?.brief.shots.find((s) => s.id === shotId)
    if (!shot) throw new Error("That shot is gone.")
    ad.shots[shotId] = this.queueShot(ad, shot)
    this.store.patch("ads", id, { status: "making", shots: ad.shots, error: null })
    this.emit(ad)
    return ad
  }

  queueShot(ad, shot) {
    const meta = (stage) => ({ source: "ad-part", adId: ad.id, shotId: shot.id, stage, label: `${ad.brief.title} · shot ${ad.brief.shots.indexOf(shot) + 1}` })
    if (shot.source === "product-photo") {
      const job = this.jobs.enqueue({ appId: this.clipApp(ad, true), values: this.clipValues(ad, shot, ad.productAssetId), meta: meta("clip") })[0]
      return { status: "making", clipJob: job.id }
    }
    // Generated scenes: Pro and Draft go straight from words to video; Instant
    // makes a still first and moves the camera over it.
    if (ad.engine === "instant") {
      const job = this.jobs.enqueue({ appId: "image-fast", values: { prompt: `${shot.visual}, photorealistic, natural light`, aspect: stillAspect(ad.brief.aspect) }, meta: meta("still") })[0]
      return { status: "making", stillJob: job.id }
    }
    const job = this.jobs.enqueue({ appId: this.clipApp(ad, false), values: this.clipValues(ad, shot, null), meta: meta("clip") })[0]
    return { status: "making", clipJob: job.id }
  }

  clipApp(ad, fromImage) {
    if (ad.engine === "pro") return fromImage ? "video-pro" : "video-scene"
    if (ad.engine === "draft") return "video-draft"
    return "video-instant"
  }

  clipValues(ad, shot, imageAssetId) {
    const seconds = Math.max(2, Math.ceil(shot.seconds))
    if (ad.engine === "instant") return { image: imageAssetId, camera: shot.camera, aspect: motionAspect(ad.brief.aspect), duration: seconds }
    if (ad.engine === "draft") return { ...(imageAssetId ? { image: imageAssetId } : {}), prompt: shot.visual, camera: shot.camera, aspect: "9:16", duration: Math.min(5, seconds) }
    const lang = ad.brief.language === "zh" ? "Mandarin" : "English"
    const prompt = shot.voiceover ? `${shot.visual}. A warm voice says in ${lang}: "${shot.voiceover}"` : shot.visual
    const audio = shot.voiceover ? (ad.brief.language === "zh" ? "warm-zh" : "warm-en") : "ambient"
    const base = { prompt, camera: shot.camera, audio, duration: seconds, quality: "fast" }
    return imageAssetId ? { ...base, image: imageAssetId } : { ...base, aspect: ad.brief.aspect === "4:5" ? "3:4" : ad.brief.aspect, style: "none" }
  }

  async onJobFinished(job) {
    const ad = this.get(job.adId)
    if (!ad) return
    if (job.stage === "render") {
      const r = ad.renders.find((x) => x.jobId === job.id)
      if (r) Object.assign(r, { status: job.status, assetId: job.outputs?.[0] ?? null, error: job.error ?? null })
      const ok = job.status === "done"
      this.store.patch("ads", ad.id, { renders: ad.renders, status: ok ? "done" : ad.status === "rendering" ? "failed" : ad.status, error: ok ? null : job.error ?? null, outputAssetId: ok ? job.outputs[0] : ad.outputAssetId })
      this.emit(ad)
      return
    }
    const state = ad.shots[job.shotId]
    if (!state || (state.stillJob !== job.id && state.clipJob !== job.id)) return // superseded
    if (job.status !== "done") {
      state.status = job.status === "canceled" ? "canceled" : "failed"
      state.error = job.error ?? "Canceled"
      this.store.patch("ads", ad.id, { shots: ad.shots, status: "failed", error: `Shot ${ad.brief.shots.findIndex((s) => s.id === job.shotId) + 1}: ${state.error}` })
      this.emit(ad)
      return
    }
    if (job.stage === "still") {
      const shot = ad.brief.shots.find((s) => s.id === job.shotId)
      state.stillAssetId = job.outputs[0]
      const clip = this.jobs.enqueue({ appId: this.clipApp(ad, true), values: this.clipValues(ad, shot, state.stillAssetId), meta: { source: "ad-part", adId: ad.id, shotId: shot.id, stage: "clip", label: job.label } })[0]
      state.clipJob = clip.id
    } else {
      state.clipAssetId = job.outputs[0]
      state.status = "done"
    }
    this.store.patch("ads", ad.id, { shots: ad.shots })
    this.emit(ad)
    this.maybeRender(ad)
  }

  maybeRender(ad) {
    const ready = ad.brief.shots.every((s) => ad.shots[s.id]?.status === "done")
    if (ready && ad.status === "making") this.render(ad.id)
  }

  /** Edit the made shots into a finished ad, optionally for another platform. */
  render(id, { platform } = {}) {
    const ad = this.get(id)
    if (!ad) throw new Error("That ad is gone.")
    if (!ad.brief.shots.every((s) => ad.shots[s.id]?.status === "done")) throw new Error("Make the shots first.")
    const p = platformById(platform ?? ad.brief.platform)
    const job = this.jobs.enqueue({ appId: "ad-render", values: { adId: ad.id, platform: p.id }, meta: { source: "ad", adId: ad.id, stage: "render", label: `${ad.brief.title} · ${p.label}` } })[0]
    ad.renders.push({ jobId: job.id, platform: p.id, status: "queued", createdAt: Date.now() })
    this.store.patch("ads", id, { renders: ad.renders, status: "rendering" })
    this.emit(ad)
    return ad
  }

  /** The local runner behind the "ad-render" app. */
  async runRender({ values, workDir, onProgress, signal }) {
    const ad = this.get(values.adId)
    if (!ad) throw new Error("That ad is gone.")
    const brand = this.brand(ad.brandId)
    const brief = { ...ad.brief, platform: values.platform || ad.brief.platform }
    const clips = brief.shots.map((s) => {
      const asset = this.library.get(ad.shots[s.id]?.clipAssetId)
      if (!asset) throw new Error("A shot's clip was deleted from the library. Make it again.")
      return { path: this.library.pathOf(asset), hasAudio: !!asset.hasAudio }
    })
    const cutoutAsset = this.library.get(ad.cutoutAssetId) ?? this.library.get(ad.productAssetId)
    if (!cutoutAsset) throw new Error("The end card needs a product photo.")
    const music = ad.musicAssetId && this.library.get(ad.musicAssetId) ? this.library.pathOf(this.library.get(ad.musicAssetId)) : brief.music
    const font = brief.language === "zh" ? this.settings.get("captionFont") : process.env.KINO_LATIN_FONT || "DejaVu Sans"
    const out = join(workDir, "ad.mp4")
    await renderAd({ brief, brand, clips, cutout: this.library.pathOf(cutoutAsset), out, workDir, font, music, onProgress, signal })
    return [{ path: out, filename: `${brief.title}.mp4`, mime: "video/mp4" }]
  }

  emit(ad) {
    this.events.emit("ad", this.get(ad.id) ?? ad)
  }
}

const sameShot = (a, b) => a.source === b.source && a.visual === b.visual && a.camera === b.camera && a.seconds === b.seconds && a.voiceover === b.voiceover
const stillAspect = (aspect) => (aspect === "4:5" ? "4:5" : aspect === "1:1" ? "1:1" : "9:16")
const motionAspect = (aspect) => (["9:16", "1:1", "4:5", "16:9"].includes(aspect) ? aspect : "9:16")
const mimeOf = (p) => (p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg")
