// The app registry: built-in apps from apps/catalog.mjs plus workflows people
// import. Also the two jobs every request needs: turning what the composer sent
// into a complete, valid set of values, and describing apps to the browser.

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { APPS, TOOLS } from "../apps/catalog.mjs"
import { ASPECTS, AUDIO, CAMERA, STYLES, aspectById } from "./presets.mjs"
import { checkBindings } from "./comfy/graph.mjs"
import { uiToApi, registryFromObjectInfo } from "./comfy/ui2api.mjs"
import { validatePrompt } from "./comfy/validate.mjs"
import { newId } from "./store.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const FILE_TYPES = new Set(["image", "audio", "video"])
const MAX_SEED = 2 ** 32

// Apps the studio runs for itself; never shown in the composer.
const INTERNAL = [
  {
    id: "ad-render",
    tool: "ads",
    label: "Ad edit",
    model: "Kino editor (ffmpeg)",
    local: "ad-render",
    output: "video",
    gpu: 0,
    seconds: 30,
    hidden: true,
    blurb: "Cuts the shots, captions and end card into the finished ad.",
    params: [
      { id: "adId", type: "text", required: true },
      { id: "platform", type: "text" },
    ],
  },
]

export function loadWorkflows(dir = join(ROOT, "workflows")) {
  const out = {}
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) out[f.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, f), "utf8"))
  return out
}

export function loadRegistry(file = join(ROOT, "comfy", "core_nodes.json")) {
  return JSON.parse(readFileSync(file, "utf8"))
}

export class Apps {
  constructor({ store, workflows = loadWorkflows(), registry = loadRegistry() }) {
    this.store = store
    this.workflows = workflows
    this.registry = registry
    for (const app of APPS) {
      if (app.local) continue
      const wf = workflows[app.workflow]
      if (!wf) throw new Error(`app ${app.id}: workflow ${app.workflow} not built (run scripts/build-workflows.mjs)`)
      const problems = checkBindings(wf, app.params)
      if (problems.length) throw new Error(`app ${app.id}: ${problems.join("; ")}`)
    }
  }

  /** What the composer offers: built-in and imported apps. */
  list() {
    return [...APPS, ...this.store.list("apps").map(hydrateCustom)]
  }

  get(id) {
    const builtin = APPS.find((a) => a.id === id) ?? INTERNAL.find((a) => a.id === id)
    if (builtin) return builtin
    const custom = this.store.get("apps", id)
    return custom ? hydrateCustom(custom) : null
  }

  workflowFor(app) {
    if (app.custom) return app.workflowData
    return this.workflows[app.workflow]
  }

  /** Model files each app needs, for the Settings readiness check. */
  modelsFor(app) {
    return app.local ? [] : this.workflowFor(app)?.models ?? []
  }

  /**
   * Import a ComfyUI workflow, UI or API format. `objectInfo` (a live server's
   * /object_info) lets UI-format workflows with custom nodes convert too.
   */
  importWorkflow({ name, workflow, tool = "custom", objectInfo }) {
    if (!workflow || typeof workflow !== "object") throw new Error("That file isn't a ComfyUI workflow.")
    const registry = objectInfo ? mergeRegistry(this.registry, registryFromObjectInfo(objectInfo)) : this.registry
    let prompt
    let exposed = []
    const warnings = []
    if (isApiFormat(workflow)) {
      prompt = structuredClone(workflow)
    } else if (Array.isArray(workflow.nodes)) {
      const unknown = [...new Set(workflow.nodes.map((n) => n.type))].filter(
        (t) => !registry.nodes[t] && !["Note", "MarkdownNote", "Reroute", "PrimitiveNode"].includes(t) && !(workflow.definitions?.subgraphs ?? []).some((s) => s.id === t),
      )
      if (unknown.length) {
        throw new Error(
          `This workflow uses custom nodes Kino can't read offline (${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ", …" : ""}). ` +
            `In ComfyUI choose Workflow → Export (API) and import that file, or connect your ComfyUI server in Settings and try again.`,
        )
      }
      const converted = uiToApi(workflow, registry)
      prompt = converted.prompt
      exposed = converted.exposed
      warnings.push(...converted.warnings)
    } else {
      throw new Error("That file isn't a ComfyUI workflow.")
    }
    if (!Object.keys(prompt).length) throw new Error("The workflow has no nodes that produce an output.")

    // Nodes the registry doesn't know are custom nodes: fine as long as the server
    // running the workflow has them, so they warn rather than fail.
    const check = validatePrompt(prompt, registry)
    const unknownNodes = [...new Set(check.errors.map((e) => e.match(/unknown node type (.+)$/)?.[1]).filter(Boolean))]
    if (unknownNodes.length) warnings.push(`Uses custom nodes your ComfyUI must have installed: ${unknownNodes.join(", ")}`)
    const hard = check.errors.filter((e) => !/unknown node type/.test(e) && !(unknownNodes.length && /no output node/.test(e)))
    if (hard.length) throw new Error(`The workflow doesn't validate: ${hard.slice(0, 3).join("; ")}`)

    const { params, output } = detectParams(prompt, exposed)
    const id = newId("app")
    const row = {
      id,
      custom: true,
      tool,
      label: String(name || "My workflow").slice(0, 60),
      model: "Custom ComfyUI workflow",
      output,
      gpu: 24,
      seconds: output === "video" ? 180 : 30,
      blurb: "Imported workflow.",
      params,
      workflowData: { prompt, exposed, models: modelsInPrompt(prompt) },
      createdAt: Date.now(),
    }
    this.store.put("apps", row)
    return { app: hydrateCustom(row), warnings }
  }

  remove(id) {
    return this.store.remove("apps", id)
  }
}

export const isApiFormat = (wf) => {
  const values = Object.values(wf)
  return values.length > 0 && values.every((n) => n && typeof n === "object" && typeof n.class_type === "string" && n.inputs && typeof n.inputs === "object")
}

function mergeRegistry(base, live) {
  return { ...base, nodes: { ...base.nodes, ...live.nodes } }
}

const LOADER_MODEL_INPUTS = /(_name|^model|^ckpt|^unet|^vae|^clip|^lora)/

function modelsInPrompt(prompt) {
  const out = []
  for (const node of Object.values(prompt)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v === "string" && /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(v) && LOADER_MODEL_INPUTS.test(k)) out.push({ name: v, directory: "", url: "" })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Imported workflows: find the handful of knobs worth showing.

const TEXT_KEYS = ["text", "prompt", "positive_prompt", "text_g", "string", "value"]
const TEXT_NODE = /TextEncode|Prompt|^CLIPText|Text(Multiline)?$|^String/i
const VIDEO_OUT = /Video|WEBM|Animated|VHS_VideoCombine/i
const AUDIO_OUT = /^SaveAudio/i
const LATENT_SIZE = /Latent|ImageToVideo|EmptyImage|ResolutionSelector/i

function detectParams(prompt, exposed) {
  const params = []
  const used = new Set()
  const take = (id, input) => used.add(`${id}.${input}`)
  const isLink = (v) => Array.isArray(v) && v.length === 2

  // Which nodes feed a "negative" input (within a few hops)?
  const negative = new Set()
  const upstream = (id, depth) => {
    if (depth > 3 || !prompt[id]) return
    negative.add(id)
    for (const v of Object.values(prompt[id].inputs)) if (isLink(v)) upstream(String(v[0]), depth + 1)
  }
  for (const node of Object.values(prompt)) {
    for (const [k, v] of Object.entries(node.inputs)) if (/negative/i.test(k) && isLink(v)) upstream(String(v[0]), 0)
  }

  // 1. Text: author-exposed names first, then encoder text widgets.
  const positives = []
  const negatives = []
  for (const e of exposed) {
    if (e.type !== "STRING") continue
    const [id, input] = e.targets[0]
    const value = prompt[id]?.inputs[input]
    if (typeof value !== "string") continue
    ;(negative.has(id) || /negative/i.test(e.name) ? negatives : positives).push({ targets: e.targets, value, label: e.name })
    e.targets.forEach(([i, k]) => take(i, k))
  }
  for (const [id, node] of Object.entries(prompt)) {
    if (!TEXT_NODE.test(node.class_type)) continue
    for (const key of TEXT_KEYS) {
      const value = node.inputs[key]
      if (typeof value !== "string" || used.has(`${id}.${key}`)) continue
      take(id, key)
      ;(negative.has(id) ? negatives : positives).push({ targets: [[id, key]], value, label: node._meta?.title || node.class_type })
    }
  }
  // Encoders that share a text (SDXL g/l, dual encoders) become one box.
  const group = (list) => {
    const out = []
    for (const t of list) {
      const same = out.find((o) => o.value === t.value)
      if (same) same.targets.push(...t.targets)
      else out.push({ ...t, targets: [...t.targets] })
    }
    return out
  }
  group(positives).forEach((t, i) =>
    params.push({ id: i === 0 ? "prompt" : `text_${i + 1}`, type: "prompt", label: i === 0 ? "Prompt" : t.label, required: i === 0, default: i === 0 ? "" : t.value, bind: bindFor(t.targets) }),
  )
  group(negatives).forEach((t, i) => params.push({ id: i === 0 ? "negative" : `negative_${i + 1}`, type: "text", label: "Avoid", default: t.value, advanced: true, bind: bindFor(t.targets) }))

  // 2. Files.
  let n = { image: 0, audio: 0, video: 0 }
  for (const [id, node] of Object.entries(prompt)) {
    const kind = { LoadImage: "image", LoadAudio: "audio", LoadVideo: "video", VHS_LoadVideo: "video" }[node.class_type]
    if (!kind) continue
    const field = { image: "image", audio: "audio", video: node.class_type === "VHS_LoadVideo" ? "video" : "file" }[kind]
    n[kind]++
    params.push({ id: `${kind}_${n[kind]}`, type: kind, label: node._meta?.title && !/^Load /.test(node._meta.title) ? node._meta.title : `${cap(kind)}${n[kind] > 1 ? ` ${n[kind]}` : ""}`, required: true, bind: `node:${id}.${field}` })
    take(id, field)
  }

  // 3. Size: one latent/size node with numeric width and height.
  const sizeNode = Object.entries(prompt).find(([id, node]) => LATENT_SIZE.test(node.class_type) && typeof node.inputs.width === "number" && typeof node.inputs.height === "number" && !used.has(`${id}.width`))
  if (sizeNode) {
    const [id, node] = sizeNode
    const { width, height } = node.inputs
    const nearest = ASPECTS.reduce((best, a) => (Math.abs(a.w / a.h - width / height) < Math.abs(best.w / best.h - width / height) ? a : best))
    const multiple = width % 64 === 0 && height % 64 === 0 ? 64 : width % 16 === 0 && height % 16 === 0 ? 16 : 8
    const megapixels = +((width * height) / (1024 * 1024)).toFixed(3)
    params.push({ id: "aspect", type: "aspect", default: nearest.id, options: ASPECTS.map((a) => a.id) })
    params.push({ id: "width", type: "derived", bind: `node:${id}.width`, derive: { from: "aspect", side: "width", megapixels, multiple } })
    params.push({ id: "height", type: "derived", bind: `node:${id}.height`, derive: { from: "aspect", side: "height", megapixels, multiple } })
    take(id, "width")
    take(id, "height")
  }

  // 4. Remaining author-exposed knobs, as plain controls.
  for (const e of exposed) {
    if (["IMAGE_FILE", "AUDIO_FILE", "VIDEO_FILE", "STRING"].includes(e.type)) continue
    const [id, input] = e.targets[0]
    if (used.has(`${id}.${input}`) || /(^|\.)(noise_)?seed$/.test(input)) continue
    const value = prompt[id]?.inputs[input]
    const type = typeof value === "boolean" ? "toggle" : typeof value === "number" ? "number" : null
    if (!type) continue
    params.push({ id: `x_${params.length}`, type, label: e.name, default: value, advanced: true, bind: bindFor(e.targets) })
    e.targets.forEach(([i, k]) => take(i, k))
  }

  // 5. Seeds.
  const hasSeed = Object.values(prompt).some((node) => Object.entries(node.inputs).some(([k, v]) => /(^|\.)(noise_)?seed$/.test(k) && typeof v === "number"))
  if (hasSeed) params.push({ id: "seed", type: "seed", label: "Seed", bind: "seeds" })

  const outputs = Object.values(prompt).map((n) => n.class_type).filter((c) => /^(Save|Preview)|VideoCombine/.test(c))
  const output = outputs.some((c) => VIDEO_OUT.test(c)) ? "video" : outputs.some((c) => AUDIO_OUT.test(c)) ? "audio" : "image"
  return { params, output }
}

const bindFor = (targets) => (targets.length === 1 ? `node:${targets[0][0]}.${targets[0][1]}` : targets.map(([id, k]) => `node:${id}.${k}`))
const cap = (s) => s[0].toUpperCase() + s.slice(1)

/** Custom apps are stored as JSON, so their computed params get their functions back here. */
function hydrateCustom(row) {
  return {
    ...row,
    params: row.params.map((p) => {
      if (!p.derive) return p
      const { from, side, megapixels, multiple } = p.derive
      return { ...p, map: (_, all) => sizeFromAspect(all[from], megapixels, multiple)[side] }
    }),
  }
}

function sizeFromAspect(aspectId, megapixels, multiple) {
  const a = aspectById(aspectId)
  const scale = Math.sqrt((megapixels * 1024 * 1024) / (a.w * a.h))
  return {
    width: Math.max(multiple, Math.round((a.w * scale) / multiple) * multiple),
    height: Math.max(multiple, Math.round((a.h * scale) / multiple) * multiple),
  }
}

// ---------------------------------------------------------------------------
// Values.

const ids = (list) => new Set(list.map((x) => x.id))
const CAMERA_IDS = ids(CAMERA)
const STYLE_IDS = ids(STYLES)
const AUDIO_IDS = ids(AUDIO)

/**
 * Fill in defaults, coerce types and check required inputs. File params carry
 * asset ids at this point; `assetExists` verifies them. Throws a message fit for
 * the person using the studio.
 */
export function resolveValues(app, input = {}, { assetExists = () => true, random = Math.random } = {}) {
  const values = {}
  for (const p of app.params) {
    let v = input[p.id]
    switch (p.type) {
      case "prompt":
      case "text":
        v = typeof v === "string" ? v.trim() : (p.default ?? "")
        if (p.required && !v) throw new Error(app.tool === "edit" ? "Describe the change you want." : "Write a prompt first.")
        if (v.length > 4000) throw new Error("That prompt is too long (4,000 characters max).")
        break
      case "image":
      case "audio":
      case "video":
        if (v == null || v === "") {
          if (p.required) throw new Error(`Add ${article(p.label ?? p.type)}.`)
          v = undefined
        } else if (!assetExists(v, p.type)) {
          throw new Error(`The ${(p.label ?? p.type).toLowerCase()} you picked is no longer in your library.`)
        }
        break
      case "aspect":
        v = (p.options ?? ASPECTS.map((a) => a.id)).includes(v) ? v : p.default
        break
      case "camera":
        v = CAMERA_IDS.has(v) ? v : p.default
        break
      case "style":
        v = STYLE_IDS.has(v) ? v : (p.default ?? "none")
        break
      case "audioMood":
        v = AUDIO_IDS.has(v) ? v : p.default
        break
      case "duration": {
        const n = Number(v)
        v = Number.isFinite(n) ? Math.min(p.max ?? 10, Math.max(p.min ?? 1, Math.round(n / (p.step ?? 1)) * (p.step ?? 1))) : p.default
        break
      }
      case "number": {
        const n = Number(v)
        v = Number.isFinite(n) ? n : p.default
        break
      }
      case "select":
        v = v in (p.options ?? {}) ? v : p.default
        break
      case "toggle":
        v = v === undefined ? !!p.default : v === true || v === "true" || v === 1
        break
      case "seed": {
        const n = Number(v)
        v = v !== undefined && v !== null && v !== "" && Number.isInteger(n) && n >= 0 ? n % MAX_SEED : Math.floor(random() * MAX_SEED)
        break
      }
      case "derived":
        v = undefined
        break
      default:
        throw new Error(`app ${app.id}: unknown param type ${p.type}`)
    }
    if (v !== undefined) values[p.id] = v
  }
  // Derived values last: they read the others.
  for (const p of app.params) if (p.type === "derived" && p.map) values[p.id] = p.map(undefined, values)
  return values
}

const article = (label) => (/^[aeiou]/i.test(label) ? `an ${label.toLowerCase()}` : `a ${label.toLowerCase()}`)

// ---------------------------------------------------------------------------
// The browser's view of the catalogue (no functions, no workflow graphs).

export function describeApp(app) {
  return {
    id: app.id,
    tool: app.tool,
    label: app.label,
    model: app.model,
    output: app.output,
    gpu: app.gpu,
    seconds: app.seconds,
    blurb: app.blurb,
    local: !!app.local,
    custom: !!app.custom,
    params: app.params
      .filter((p) => p.type !== "derived")
      .map(({ id, type, label, default: def, required, options, min, max, step, advanced }) => ({ id, type, label, default: def, required: !!required, options, min, max, step, advanced: !!advanced })),
  }
}

export function catalogue(apps) {
  return {
    tools: [...TOOLS, ...(apps.list().some((a) => a.custom) ? [{ id: "custom", label: "My workflows", icon: "puzzle", blurb: "Workflows you imported" }] : [])],
    apps: apps.list().map(describeApp),
    presets: {
      aspects: ASPECTS.map(({ id, label, hint, w, h }) => ({ id, label, hint, w, h })),
      camera: CAMERA.map(({ id, label, group, phrase, preview }) => ({ id, label, group, phrase, preview })),
      styles: STYLES.map(({ id, label, suffix }) => ({ id, label, suffix })),
      audio: AUDIO.map(({ id, label, phrase }) => ({ id, label, phrase })),
    },
  }
}

export { FILE_TYPES }
