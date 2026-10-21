#!/usr/bin/env node
// Checks that every file "This computer" can download still answers, and how
// big it is: model files move on Hugging Face more often than you'd think.
//   node scripts/check-engine-files.mjs          exit 1 if any model file is gone
//   node scripts/check-engine-files.mjs --json   sizes as JSON, for updating catalog.mjs

import { FFMPEG_SOURCES, METAL_BUILD_URL, PACKS, packFiles } from "../src/engine/catalog.mjs"

const json = process.argv.includes("--json")
const files = PACKS.flatMap((p) => packFiles(p).map((f) => ({ pack: p.id, ...f })))

/** HEAD a URL; network errors are retried, and other answers too when `retryStatus`. */
async function head(url, { tries = 3, retryStatus = false, timeoutMs = 30_000 } = {}) {
  let last
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "Kino engine-files check" }, signal: AbortSignal.timeout(timeoutMs) })
      last = { status: res.status, bytes: Number(res.headers.get("content-length")) || 0 }
      if (res.status === 200 || !retryStatus) return last
    } catch (e) {
      last = { status: 0, error: e.cause?.code ?? e.message }
    }
    if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
  }
  return last
}

// Model files sit on big hosts: all at once. ffmpeg's sources are small hosts
// whose "latest" links blink out now and then, so they're asked one at a time,
// with retries, and a platform stops at its first candidate that fully answers
// (the rest are only fallbacks).
const models = await Promise.all(files.map(async (f) => ({ ...f, ...(await head(f.url)) })))
const ffmpeg = []
for (const [platform, candidates] of Object.entries(FFMPEG_SOURCES)) {
  for (const [n, urls] of candidates.entries()) {
    const checked = []
    for (const url of urls) {
      const name = new URL(url).pathname.split("/").slice(-2).join("/")
      checked.push({ pack: `ffmpeg ${platform}`, platform, candidate: n, name, url, optional: true, ...(await head(url, { tries: 3, retryStatus: true, timeoutMs: 15_000 })) })
    }
    ffmpeg.push(...checked)
    if (checked.every((r) => r.status === 200)) break
  }
}
const results = [...models, ...ffmpeg]
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
