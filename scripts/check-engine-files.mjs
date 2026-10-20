#!/usr/bin/env node
// Checks that every file "This computer" can download still answers, and how
// big it is: model files move on Hugging Face more often than you'd think.
//   node scripts/check-engine-files.mjs          exit 1 if any model file is gone
//   node scripts/check-engine-files.mjs --json   sizes as JSON, for updating catalog.mjs

import { FFMPEG_SOURCES, METAL_BUILD_URL, PACKS, packFiles } from "../src/engine/catalog.mjs"
import { fileName } from "../src/engine/download.mjs"

const json = process.argv.includes("--json")
const files = PACKS.flatMap((p) => packFiles(p).map((f) => ({ pack: p.id, ...f })))
// ffmpeg sources are fallbacks: a platform is fine while any one of its candidates answers.
const ffmpeg = Object.entries(FFMPEG_SOURCES).flatMap(([platform, candidates]) =>
  candidates.flatMap((urls, n) => urls.map((url) => ({ pack: `ffmpeg ${platform}`, platform, candidate: n, name: fileName(url), url, optional: true }))),
)

async function head(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "Kino engine-files check" }, signal: AbortSignal.timeout(30_000) })
      return { status: res.status, bytes: Number(res.headers.get("content-length")) || 0 }
    } catch (e) {
      if (attempt === 2) return { status: 0, error: e.cause?.code ?? e.message }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
}

const results = await Promise.all([...files, ...ffmpeg].map(async (f) => ({ ...f, ...(await head(f.url)) })))
const metal = await head(METAL_BUILD_URL)

if (json) {
  console.log(JSON.stringify(Object.fromEntries(results.map((r) => [r.name, r.bytes])), null, 2))
} else {
  for (const r of results) {
    const ok = r.status === 200
    const size = r.bytes ? `${(r.bytes / 1e9).toFixed(2)} GB` : "?"
    const drift = ok && r.gb && r.bytes && Math.abs(r.bytes / 1e9 - r.gb) / r.gb > 0.15 ? `  (catalog says ~${r.gb} GB)` : ""
    const where = r.optional ? `${r.pack} #${r.candidate + 1}` : r.pack
    console.log(`${ok ? "ok  " : r.optional ? "miss" : "GONE"}  ${where.padEnd(22)} ${r.name.padEnd(48)} ${ok ? size : r.status || r.error}${drift}`)
  }
  console.log(`${metal.status === 200 ? "ok  " : "note"}  Metal build for Apple Silicon: ${metal.status === 200 ? "published" : "not published yet (run the Engine workflow)"}`)
}
const modelsOk = results.filter((r) => !r.optional).every((r) => r.status === 200)
const ffmpegOk = Object.entries(FFMPEG_SOURCES).every(([platform, candidates]) =>
  candidates.some((_, n) => results.filter((r) => r.platform === platform && r.candidate === n).every((r) => r.status === 200)),
)
if (!json && !ffmpegOk) console.log("GONE  a platform has no working ffmpeg source left")
process.exit(modelsOk && ffmpegOk ? 0 : 1)
