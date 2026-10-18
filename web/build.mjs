#!/usr/bin/env node
// Builds Kino's web demo: the real interface (public/) plus the in-browser
// engine (web/engine.mjs, web/render.mjs), the server modules it shares
// (presets, prompts, ad templates, compliance, captions), the brand files and
// the seed library. The output is static: any web host serves it, e.g.
// `node web/build.mjs ../public/kino` for the portfolio's GitHub Pages site.

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = process.argv[2] ?? join(ROOT, "web", "dist")

// Shared with the server; each must stay free of Node built-ins.
const SHARED = ["presets.mjs", "prompt.mjs", "ads/schema.mjs", "ads/compliance.mjs", "ads/platforms.mjs", "ads/captions.mjs", "ads/templates.mjs"]

// GitHub Pages and some hosts serve .mjs with the wrong type; ship .js.
const toJs = (src) => src.replace(/((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']+?)\.mjs(["'])/g, "$1$2.js$3")

async function writeJs(from, to) {
  const src = await readFile(from, "utf8")
  if (/from\s+["']node:/.test(src)) throw new Error(`${from} imports a Node built-in, so it can't run in the browser.`)
  await mkdir(dirname(to), { recursive: true })
  await writeFile(to, toJs(src))
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// The interface, unchanged apart from the module extension.
await cp(join(ROOT, "public"), out, { recursive: true, filter: (p) => !p.endsWith(".mjs") })
for (const f of await readdir(join(ROOT, "public", "js"))) {
  if (f.endsWith(".mjs")) await writeJs(join(ROOT, "public", "js", f), join(out, "js", f.replace(/\.mjs$/, ".js")))
}
let html = await readFile(join(ROOT, "public", "index.html"), "utf8")
html = html
  .replace('<script type="module" src="js/main.mjs"></script>', '<script type="module" src="engine/engine.js"></script>\n<script type="module" src="js/main.js"></script>')
  .replace(/<title>[^<]*<\/title>/, "<title>Kino · web demo</title>")
  .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Kino, an AI image and video studio for small brands, running in your browser: guided tasks, camera moves and compliance-checked video ads.">')
if (!html.includes("engine/engine.js")) throw new Error("index.html changed: couldn't add the web engine before main.js.")
await writeFile(join(out, "index.html"), html)

// The engine and what it shares with the server.
await writeJs(join(ROOT, "web", "engine.mjs"), join(out, "engine", "engine.js"))
await writeJs(join(ROOT, "web", "render.mjs"), join(out, "engine", "render.js"))
for (const f of SHARED) await writeJs(join(ROOT, "src", f), join(out, "engine", "lib", f.replace(/\.mjs$/, ".js")))

// Seed library and brand profiles.
await cp(join(ROOT, "web", "seed"), join(out, "engine", "seed"), { recursive: true })
await mkdir(join(out, "engine", "seed", "brands"), { recursive: true })
for (const f of await readdir(join(ROOT, "brands"))) {
  if (f.endsWith(".json")) await cp(join(ROOT, "brands", f), join(out, "engine", "seed", "brands", f))
}

console.log(`Kino web demo built in ${out}`)
