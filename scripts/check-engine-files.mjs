#!/usr/bin/env node
// Checks that every file "This computer" can download still answers, and how
// big it is: model files move on Hugging Face more often than you'd think.
//   node scripts/check-engine-files.mjs          exit 1 if any model file is gone
//   node scripts/check-engine-files.mjs --json   sizes as JSON, for updating catalog.mjs

import { METAL_BUILD_URL, PACKS, packFiles } from "../src/engine/catalog.mjs"

const json = process.argv.includes("--json")
const files = PACKS.flatMap((p) => packFiles(p).map((f) => ({ pack: p.id, ...f })))

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

const results = await Promise.all(files.map(async (f) => ({ ...f, ...(await head(f.url)) })))
const metal = await head(METAL_BUILD_URL)

if (json) {
  console.log(JSON.stringify(Object.fromEntries(results.map((r) => [r.name, r.bytes])), null, 2))
} else {
  for (const r of results) {
    const ok = r.status === 200
    const size = r.bytes ? `${(r.bytes / 1e9).toFixed(2)} GB` : "?"
    const drift = ok && r.gb && r.bytes && Math.abs(r.bytes / 1e9 - r.gb) / r.gb > 0.15 ? `  (catalog says ~${r.gb} GB)` : ""
    console.log(`${ok ? "ok  " : "GONE"}  ${r.pack.padEnd(12)} ${r.name.padEnd(52)} ${ok ? size : r.status || r.error}${drift}`)
  }
  console.log(`${metal.status === 200 ? "ok  " : "note"}  Metal build for Apple Silicon: ${metal.status === 200 ? "published" : "not published yet (run the Engine workflow)"}`)
}
process.exit(results.every((r) => r.status === 200) ? 0 : 1)
