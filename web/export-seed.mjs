#!/usr/bin/env node
// Exports the web demo's starting library from a running Kino (demo mode is
// fine): the brand photos, a couple of finished ads and camera moves, the
// bootstrap and the model list. Run once when the seed should change:
//   KINO_URL=http://127.0.0.1:7861 node web/export-seed.mjs

import { spawnSync } from "node:child_process"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = process.env.KINO_URL ?? "http://127.0.0.1:7861"
const SEED = join(dirname(fileURLToPath(import.meta.url)), "seed")
const REPO = "https://github.com/JamesLiuZX/kino"

const get = async (path) => {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res
}
const json = async (path) => (await get(path)).json()

await rm(SEED, { recursive: true, force: true })
await mkdir(join(SEED, "media"), { recursive: true })

const boot = await json("/api/bootstrap")
boot.provider = { id: "mock", label: "Web demo", web: true }
boot.claude = { available: false, reason: "The web demo writes from approved templates. The full studio can use Claude." }
boot.web = { repo: REPO }
await writeFile(join(SEED, "bootstrap.json"), JSON.stringify(boot))
await writeFile(join(SEED, "models.json"), JSON.stringify(await json("/api/models")))

const assets = await json("/api/assets?limit=500")
const allAds = await json("/api/ads")
const pickAd = (angle) => allAds.find((a) => a.status === "done" && a.brief.angle === angle && a.brief.language === "zh" && a.outputAssetId)
const ads = ["ritual", "gift"].map(pickAd).filter(Boolean)
const byId = new Map(assets.map((a) => [a.id, a]))
const pickMove = (camera) => assets.find((a) => a.appId === "video-instant" && a.values?.camera === camera)

const keep = [
  ...assets.filter((a) => a.source === "brand"),
  ...ads.map((ad) => byId.get(ad.outputAssetId)),
  ...["push-in", "orbit"].map(pickMove),
].filter(Boolean)

// Studio renders are 1080p for the platforms; the demo page streams 720p.
async function webSize(path) {
  const tmp = `${path}.tmp.mp4`
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", path, "-vf", "scale='min(720,iw)':-2", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", tmp])
  if (r.status !== 0) throw new Error(`ffmpeg couldn't shrink ${path}: ${r.stderr}`)
  await rename(tmp, path)
}

const exported = []
for (const a of keep) {
  const file = a.url.split("/").pop()
  await writeFile(join(SEED, "media", file), Buffer.from(await (await get(a.url)).arrayBuffer()))
  if (a.kind === "video") await webSize(join(SEED, "media", file))
  let thumbUrl = a.kind === "image" ? `media/${file}` : null
  if (a.thumbUrl && a.kind !== "image") {
    const thumb = `thumb-${a.thumbUrl.split("/").pop()}`
    await writeFile(join(SEED, "media", thumb), Buffer.from(await (await get(a.thumbUrl)).arrayBuffer()))
    thumbUrl = `media/${thumb}`
  }
  const { jobId, thumb, ...rest } = a
  const size = a.kind === "video" && a.width > 720 ? { width: 720, height: Math.round((720 * a.height) / a.width / 2) * 2 } : {}
  exported.push({ ...rest, ...size, bytes: (await stat(join(SEED, "media", file))).size, url: `media/${file}`, thumbUrl })
}

// Finished ads, with their shots marked made so they can be re-cut for
// another platform (generated scenes get stand-ins when that happens).
const photo = keep.find((a) => a.brandImage?.endsWith(":photo"))
const seedAds = ads.map((ad) => ({
  id: ad.id,
  brandId: ad.brandId,
  engine: ad.engine,
  productAssetId: photo?.id ?? ad.productAssetId,
  cutoutAssetId: ad.cutoutAssetId,
  musicAssetId: null,
  brief: ad.brief,
  issues: ad.issues,
  status: "done",
  shots: Object.fromEntries(ad.brief.shots.map((s) => [s.id, { status: "done", clipAssetId: s.source === "product-photo" ? photo?.id : null }])),
  renders: [{ platform: ad.brief.platform, status: "done", assetId: ad.outputAssetId, createdAt: ad.createdAt }],
  outputAssetId: ad.outputAssetId,
  createdAt: ad.createdAt,
}))

await writeFile(join(SEED, "state.json"), JSON.stringify({ assets: exported, ads: seedAds }, null, 1))
console.log(`Seed: ${exported.length} files, ${seedAds.length} ads -> ${SEED}`)
