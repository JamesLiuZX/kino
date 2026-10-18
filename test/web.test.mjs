// The web demo (web/) is built from the studio's own interface and modules.
// These checks keep it buildable: shared modules must stay browser-safe, and
// the seed must point at files that exist.

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

test("the web demo builds into a static folder", () => {
  const out = join(mkdtempSync(join(tmpdir(), "kino-web-")), "kino")
  execFileSync(process.execPath, [join(ROOT, "web", "build.mjs"), out])
  const html = readFileSync(join(out, "index.html"), "utf8")
  assert.match(html, /<script type="module" src="engine\/engine\.js"><\/script>\s*<script type="module" src="js\/main\.js"><\/script>/)
  assert.ok(!html.includes('="/'), "index.html must use relative paths so the demo works under any folder")
  for (const f of ["engine/engine.js", "engine/render.js", "engine/lib/ads/templates.js", "engine/lib/ads/compliance.js", "engine/seed/bootstrap.json", "engine/seed/brands/herbalbath.json", "js/main.js"]) {
    assert.ok(existsSync(join(out, f)), `${f} is missing`)
  }
  // Every module ships as .js and imports .js.
  for (const dir of ["js", "engine", "engine/lib", "engine/lib/ads"]) {
    for (const f of readdirSync(join(out, dir)).filter((x) => x.endsWith(".js"))) {
      const src = readFileSync(join(out, dir, f), "utf8")
      assert.ok(!/\.mjs["']/.test(src), `${dir}/${f} still imports .mjs`)
      assert.ok(!/from\s+["']node:/.test(src), `${dir}/${f} imports a Node built-in`)
    }
  }
})

test("the seed library points at files that exist", () => {
  const seed = join(ROOT, "web", "seed")
  const state = JSON.parse(readFileSync(join(seed, "state.json"), "utf8"))
  const boot = JSON.parse(readFileSync(join(seed, "bootstrap.json"), "utf8"))
  assert.equal(boot.provider.web, true)
  const ids = new Set(state.assets.map((a) => a.id))
  for (const a of state.assets) {
    assert.ok(existsSync(join(seed, a.url)), `${a.url} is missing`)
    if (a.thumbUrl) assert.ok(existsSync(join(seed, a.thumbUrl)), `${a.thumbUrl} is missing`)
  }
  for (const ad of state.ads) {
    assert.ok(ids.has(ad.outputAssetId), `${ad.id}'s video isn't in the seed`)
    for (const b of boot.ads.brands) assert.ok(existsSync(join(ROOT, "brands", `${b.id}.json`)))
  }
})
