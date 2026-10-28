#!/usr/bin/env node
// Builds Kino's website: the real interface (public/) plus the in-browser
// engine (web/engine.mjs, render.mjs, ai.mjs, cloud.mjs for fal.ai, keep.mjs
// for what the browser keeps), the server modules it shares (presets, prompts,
// recipes, reframe, ad templates, compliance, captions), the app catalogue and
// built-in recipes as they are in this checkout, the brand files, the seed
// library, and the two models it runs on the visitor's device with ONNX
// Runtime Web. The output is static: any web host serves it, e.g.
// `node web/build.mjs ../public/kino --strict` for the portfolio's site.
// --strict fails the build when the models or the runtime are missing; without
// it the demo is built with stand-ins in their place. --fetch-models downloads
// missing models from the web-models release (the Web models workflow), for
// hosts that can't run scripts/web-models.py.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Apps, catalogue } from "../src/apps.mjs"
import { Store } from "../src/store.mjs"
import { builtinRecipes } from "../src/recipe-files.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith("--")) ?? join(ROOT, "web", "dist")
const strict = args.includes("--strict")
const fetchModels = args.includes("--fetch-models")

// The in-browser models (made by scripts/web-models.py) and the parts of ONNX
// Runtime Web that run them: WebGPU, and WebAssembly where there's no WebGPU.
const MODELS = { cutout: { file: "cutout.onnx", label: "cut-out model" }, upscale: { file: "upscale.onnx", label: "upscaler" } }
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist")
const ORT_FILES = ["ort.webgpu.min.mjs", "ort.wasm.min.mjs", "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]

// Shared with the server; each must stay free of Node built-ins.
const SHARED = ["presets.mjs", "prompt.mjs", "recipes.mjs", "media/reframe.mjs", "ads/schema.mjs", "ads/compliance.mjs", "ads/platforms.mjs", "ads/captions.mjs", "ads/templates.mjs"]

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
  .replace(/<title>[^<]*<\/title>/, "<title>Kino · AI photo and video studio</title>")
  .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="Kino, an AI image and video studio for small brands, running in your browser: guided tasks, camera moves and compliance-checked video ads.">')
if (!html.includes("engine/engine.js")) throw new Error("index.html changed: couldn't add the web engine before main.js.")
await writeFile(join(out, "index.html"), html)

// The engine and what it shares with the server.
await writeJs(join(ROOT, "web", "engine.mjs"), join(out, "engine", "engine.js"))
await writeJs(join(ROOT, "web", "render.mjs"), join(out, "engine", "render.js"))
await writeJs(join(ROOT, "web", "ai.mjs"), join(out, "engine", "ai.js"))
await writeJs(join(ROOT, "web", "cloud.mjs"), join(out, "engine", "cloud.js"))
await writeJs(join(ROOT, "web", "keep.mjs"), join(out, "engine", "keep.js"))
for (const f of SHARED) await writeJs(join(ROOT, "src", f), join(out, "engine", "lib", f.replace(/\.mjs$/, ".js")))

// Seed library and brand profiles. The app catalogue and the version are
// this checkout's, so the website never lags the studio's apps; the recipes
// are the built-in ones.
await cp(join(ROOT, "web", "seed"), join(out, "engine", "seed"), { recursive: true })
const seedBoot = JSON.parse(await readFile(join(ROOT, "web", "seed", "bootstrap.json"), "utf8"))
const cat = catalogue(new Apps({ store: new Store(mkdtempSync(join(tmpdir(), "kino-web-"))) }))
const version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version
// The commit it's built from, so scripts/check-website.mjs can tell whether the live site is current.
let commit = null
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
} catch {}
await writeFile(join(out, "engine", "seed", "bootstrap.json"), JSON.stringify({ ...seedBoot, version, build: { commit }, tools: cat.tools, apps: cat.apps, presets: cat.presets }))
await writeFile(join(out, "engine", "seed", "recipes.json"), JSON.stringify(builtinRecipes()))
await mkdir(join(out, "engine", "seed", "brands"), { recursive: true })
for (const f of await readdir(join(ROOT, "brands"))) {
  if (f.endsWith(".json")) await cp(join(ROOT, "brands", f), join(out, "engine", "seed", "brands", f))
}

// The models, with a manifest that names each file by its content so a new
// model never comes out of a visitor's cache as the old one.
const MODELS_URL = process.env.KINO_MODELS_URL ?? "https://github.com/JamesLiuZX/kino/releases/download/web-models"
if (fetchModels) {
  for (const m of Object.values(MODELS)) {
    const to = join(ROOT, "web", "models", m.file)
    if (existsSync(to)) continue
    const res = await fetch(`${MODELS_URL}/${m.file}`)
    if (!res.ok) throw new Error(`Couldn't download the ${m.label} from ${MODELS_URL}/${m.file} (${res.status}). Run the Web models workflow in JamesLiuZX/kino.`)
    const bytes = Buffer.from(await res.arrayBuffer())
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, bytes)
    console.log(`Downloaded the ${m.label}, ${(bytes.length / 1e6).toFixed(1)} MB`)
  }
}
const missing = [
  ...Object.values(MODELS).map((m) => join(ROOT, "web", "models", m.file)),
  ...ORT_FILES.map((f) => join(ORT_DIST, f)),
].filter((f) => !existsSync(f))
if (missing.length) {
  const why = `Missing ${missing.map((f) => f.slice(ROOT.length + 1)).join(", ")}. Make the models with \`python3 scripts/web-models.py\` and install the runtime with \`npm install\` (in kino/).`
  if (strict) throw new Error(why)
  console.warn(`${why}\nBuilding without them: background removal and upscaling will be stand-ins.`)
} else {
  await mkdir(join(out, "engine", "models"), { recursive: true })
  const manifest = {}
  for (const [id, m] of Object.entries(MODELS)) {
    const from = join(ROOT, "web", "models", m.file)
    const hash = createHash("sha256").update(await readFile(from)).digest("hex").slice(0, 12)
    await cp(from, join(out, "engine", "models", m.file))
    manifest[id] = { file: `${m.file}?v=${hash}`, bytes: (await stat(from)).size, label: m.label }
  }
  await writeFile(join(out, "engine", "models", "manifest.json"), JSON.stringify(manifest, null, 2))
  // .mjs as .js, for the same reason as the interface's modules.
  await mkdir(join(out, "engine", "ort"), { recursive: true })
  for (const f of ORT_FILES) await cp(join(ORT_DIST, f), join(out, "engine", "ort", f.replace(/\.mjs$/, ".js")))
}

console.log(`Kino web demo built in ${out}`)
