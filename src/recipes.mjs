// Recipes: a saved chain of steps that turns a few inputs (a product photo, a
// line about the scene) into a finished set, e.g. a white-background main
// image, lifestyle shots and every platform size. Each step is an ordinary job
// of an ordinary app, so it shows in the queue and lands in the library. A step
// that uses an earlier step's result waits for it, and runs once for each of
// that step's pictures; `each` runs a step once per value of one setting.
//
// The format is small JSON, so recipes can be shared, imported and kept in
// git. Built-in ones live in recipes/*.json:
//
//   { "kino": "recipe/1", "id": "story-set", "title": "...", "blurb": "...",
//     "category": "Social", "inputs": [{ "id": "photo", "type": "image", "label": "Product photo" }],
//     "steps": [{ "id": "scene", "app": "edit", "values": { "image": "{{photo}}", "prompt": "Place this product {{scene}}." } },
//               { "id": "sizes", "app": "reframe", "values": { "image": "@scene" }, "each": { "aspect": ["1:1", "9:16"] } }] }
//
// "{{input}}" as a whole value is that input (a file from the library, or
// text); inside words it's the input's text. "@step" is the pictures or videos
// an earlier step made. A step with "keep": false is a means to an end: its
// results stay out of the library's main view.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { newId } from "./store.mjs"
import { ASPECTS, CAMERA, STYLES } from "./presets.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
export const FORMAT = "recipe/1"
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/
const INPUT_TYPES = new Set(["image", "video", "audio", "text", "choice"])
const FILES = new Set(["image", "video", "audio"])
const MAX_STEPS = 12
const MAX_JOBS_PER_STEP = 12
const TERMINAL = new Set(["done", "failed", "canceled"])
const KEEP_RUNS = 100

const whole = (value) => (typeof value === "string" ? /^\{\{([a-z0-9-]+)\}\}$/.exec(value)?.[1] ?? null : null)
const stepRef = (value) => (typeof value === "string" ? /^@([a-z0-9-]+)$/.exec(value)?.[1] ?? null : null)
const named = (text) => [...String(text).matchAll(/\{\{([a-z0-9-]+)\}\}/g)].map((m) => m[1])
const words = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max
/** The values a preset-type setting can take, or null for free ones. */
function choicesFor(p) {
  if (p.type === "aspect") return p.options ?? ASPECTS.map((a) => a.id)
  if (p.type === "camera") return CAMERA.map((c) => c.id)
  if (p.type === "style") return STYLES.map((x) => x.id)
  if (p.type === "select") return Object.keys(p.options ?? {})
  return null
}
const article = (label) => (/^[aeiou]/i.test(label) ? `an ${label.toLowerCase()}` : `a ${label.toLowerCase()}`)

/** What's wrong with a recipe, in sentences; empty when it's fine. */
export function recipeProblems(r, apps) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return ["A recipe is a JSON object."]
  const out = []
  if (r.kino !== FORMAT) out.push(`"kino" must be "${FORMAT}".`)
  if (!ID.test(r.id ?? "")) out.push(`"id" is lowercase letters, digits and dashes, up to 48.`)
  if (!words(r.title, 80)) out.push(`"title" is a short line, up to 80 characters.`)
  for (const key of ["blurb", "category"]) if (r[key] !== undefined && !words(r[key], key === "blurb" ? 400 : 40)) out.push(`"${key}" is too long, or empty.`)
  const inputs = r.inputs ?? []
  const inputById = new Map()
  if (!Array.isArray(inputs) || inputs.length > 8) out.push(`"inputs" is a list of up to 8.`)
  else
    for (const [i, input] of inputs.entries()) {
      const where = `Input ${i + 1}`
      if (!ID.test(input?.id ?? "")) out.push(`${where}: "id" is lowercase letters, digits and dashes.`)
      else if (inputById.has(input.id)) out.push(`${where}: "${input.id}" is used twice.`)
      if (!INPUT_TYPES.has(input?.type)) out.push(`${where}: "type" is one of ${[...INPUT_TYPES].join(", ")}.`)
      if (!words(input?.label, 80)) out.push(`${where}: give it a "label".`)
      if (input?.type === "choice" && !(Array.isArray(input.options) && input.options.length && input.options.every((o) => words(o, 200)))) out.push(`${where}: a choice needs "options", a list of words.`)
      if (input?.default !== undefined && (FILES.has(input?.type) || typeof input.default !== "string")) out.push(`${where}: only text and choices take a "default".`)
      inputById.set(input?.id, input)
    }
  const steps = r.steps
  if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS) return [...out, `"steps" is a list of 1 to ${MAX_STEPS}.`]
  const stepById = new Map()
  for (const [i, s] of steps.entries()) {
    const where = `Step ${i + 1}${typeof s?.id === "string" ? ` (${s.id})` : ""}`
    if (!ID.test(s?.id ?? "")) out.push(`${where}: "id" is lowercase letters, digits and dashes.`)
    else if (stepById.has(s.id) || inputById.has(s.id)) out.push(`${where}: "${s.id}" is already taken.`)
    const app = typeof s?.app === "string" ? apps.get(s.app) : null
    if (!app || app.hidden) {
      out.push(`${where}: there's no app called "${s?.app}".`)
      continue
    }
    if (s.label !== undefined && !words(s.label, 80)) out.push(`${where}: "label" is a short line.`)
    if (s.count !== undefined && !(Number.isInteger(s.count) && s.count >= 1 && s.count <= 4)) out.push(`${where}: "count" is 1 to 4.`)
    const params = new Map(app.params.filter((p) => p.type !== "derived").map((p) => [p.id, p]))
    const values = s.values ?? {}
    if (typeof values !== "object" || Array.isArray(values)) {
      out.push(`${where}: "values" is an object of ${app.label}'s settings.`)
      continue
    }
    const each = s.each === undefined ? [] : typeof s.each === "object" && !Array.isArray(s.each) ? Object.entries(s.each) : null
    if (!each || each.length > 1 || (each.length && !(Array.isArray(each[0][1]) && each[0][1].length >= 1 && each[0][1].length <= 6))) out.push(`${where}: "each" names one setting and a list of up to 6 values for it.`)
    const settings = [...Object.entries(values), ...(each?.length === 1 && Array.isArray(each[0][1]) ? each[0][1].map((v) => [each[0][0], v]) : [])]
    for (const [key, value] of settings) {
      const p = params.get(key)
      if (!p) {
        out.push(`${where}: ${app.label} has no setting called "${key}".`)
        continue
      }
      const input = whole(value)
      const from = stepRef(value)
      if (FILES.has(p.type)) {
        if (input) {
          const it = inputById.get(input)
          if (!it) out.push(`${where}: "{{${input}}}" isn't one of the inputs.`)
          else if (it.type !== p.type) out.push(`${where}: "${key}" takes ${article(p.type)}, and "${input}" is ${article(it.type)}.`)
        } else if (from) {
          const earlier = stepById.get(from)
          const made = earlier && apps.get(earlier.app)?.output
          if (!earlier) out.push(`${where}: "@${from}" isn't an earlier step.`)
          else if (made !== p.type) out.push(`${where}: "${key}" takes ${article(p.type)}, and "${from}" makes ${article(made ?? "file")}.`)
        } else out.push(`${where}: "${key}" is a file: use "{{input}}" or "@step".`)
      } else if (from) out.push(`${where}: "${key}" can't take a step's result.`)
      else if (choicesFor(p) && !input && !choicesFor(p).includes(value)) out.push(`${where}: "${key}" is one of ${choicesFor(p).join(", ")}; "${value}" isn't.`)
      else if (typeof value === "string")
        for (const name of named(value)) {
          const it = inputById.get(name)
          if (!it) out.push(`${where}: "{{${name}}}" isn't one of the inputs.`)
          else if (FILES.has(it.type) && value !== `{{${name}}}`) out.push(`${where}: "{{${name}}}" is a file, so it can't go inside words.`)
        }
    }
    for (const p of params.values()) if (p.required && !settings.some(([key]) => key === p.id)) out.push(`${where}: ${app.label} needs "${p.id}".`)
    if (s.keep !== undefined && typeof s.keep !== "boolean") out.push(`${where}: "keep" is true or false.`)
    stepById.set(s.id, s)
  }
  return out
}

function loadBuiltin(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ ...JSON.parse(readFileSync(join(dir, f), "utf8")), builtin: true }))
}

export class Recipes {
  constructor({ store, apps, jobs, library, events, dir = join(ROOT, "recipes") }) {
    Object.assign(this, { store, apps, jobs, library, events })
    this.builtin = loadBuiltin(dir)
    for (const r of this.builtin) {
      const problems = recipeProblems(r, apps)
      if (problems.length) throw new Error(`recipes/${r.id}.json: ${problems.join(" ")}`)
    }
    events.on("job-finished", (job) => {
      if (job.runId) this.onJobFinished(job)
    })
  }

  // ---------------------------------------------------------------- recipes

  list() {
    return [...this.builtin, ...this.store.list("recipes").sort((a, b) => b.updatedAt - a.updatedAt)]
  }

  get(id) {
    return this.builtin.find((r) => r.id === id) ?? this.store.get("recipes", id)
  }

  /** Import or update one of your own. */
  save(recipe) {
    const { builtin, updatedAt, ...clean } = recipe ?? {}
    const problems = recipeProblems(clean, this.apps)
    if (problems.length) throw new Error(problems.slice(0, 6).join(" "))
    if (this.builtin.some((r) => r.id === clean.id)) throw new Error(`A built-in recipe is called "${clean.id}"; give yours another id.`)
    const row = { ...clean, updatedAt: Date.now() }
    this.store.put("recipes", row)
    return row
  }

  remove(id) {
    if (this.builtin.some((r) => r.id === id)) throw new Error("Built-in recipes can't be deleted.")
    return this.store.remove("recipes", id)
  }

  // ---------------------------------------------------------------- runs

  runs({ recipeId, limit = 30 } = {}) {
    return this.store
      .list("runs", (r) => !recipeId || r.recipeId === recipeId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  getRun(id) {
    return this.store.get("runs", id)
  }

  /** Check the inputs and start the steps that need nothing earlier. */
  start(id, given = {}) {
    const recipe = this.get(id)
    if (!recipe) throw new Error("That recipe is gone.")
    const inputs = {}
    for (const input of recipe.inputs ?? []) {
      let v = given[input.id]
      if (FILES.has(input.type)) {
        const asset = v ? this.library.get(v) : null
        if (!asset) {
          if (input.optional) continue
          throw new Error(`Add ${article(input.label)}.`)
        }
        if (asset.kind !== input.type) throw new Error(`${input.label}: that's not ${article(input.type)}.`)
      } else if (input.type === "choice") v = input.options.includes(v) ? v : (input.default ?? input.options[0])
      else {
        v = typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : (input.default ?? "")
        if (!v && !input.optional) throw new Error(`Fill in “${input.label}”.`)
      }
      inputs[input.id] = v
    }
    const { builtin, updatedAt, ...snapshot } = recipe
    const run = {
      id: newId("r"),
      recipeId: recipe.id,
      title: recipe.title,
      recipe: snapshot, // as it was, so editing the recipe later doesn't change this run
      inputs,
      status: "running",
      createdAt: Date.now(),
      steps: Object.fromEntries(recipe.steps.map((s) => [s.id, { status: "waiting", jobs: [], outputs: [] }])),
    }
    this.store.put("runs", run)
    this.advance(run)
    this.trim()
    return this.getRun(run.id)
  }

  cancel(id) {
    const run = this.getRun(id)
    if (!run) throw new Error("That run is gone.")
    if (run.status !== "running") return run
    run.canceled = true
    for (const step of Object.values(run.steps)) for (const jobId of step.jobs) this.jobs.cancel(jobId)
    this.advance(run)
    return this.getRun(id)
  }

  /** Forget a run; what it made stays in the library. */
  removeRun(id) {
    const run = this.getRun(id)
    if (run?.status === "running") this.cancel(id)
    const ok = this.store.remove("runs", id)
    this.events.emit("run-removed", { id })
    return ok
  }

  onJobFinished(job) {
    const run = this.getRun(job.runId)
    const step = run?.steps[job.stepId]
    if (!step?.jobs.includes(job.id)) return
    const jobs = step.jobs.map((id) => this.jobs.get(id))
    if (!jobs.every((j) => !j || TERMINAL.has(j.status))) return this.emit(run)
    step.outputs = jobs.flatMap((j) => (j?.status === "done" ? j.outputs : []))
    if (step.outputs.length) step.status = "done"
    else if (jobs.every((j) => j?.status === "canceled")) step.status = "canceled"
    else {
      step.status = "failed"
      step.error = jobs.find((j) => j?.error)?.error ?? "It didn't work."
    }
    this.advance(run)
  }

  /** Start every step whose earlier steps are all done; skip those that can't run. */
  advance(run) {
    const recipe = run.recipe
    for (let changed = true; changed; ) {
      changed = false
      for (const s of recipe.steps) {
        const step = run.steps[s.id]
        if (step.status !== "waiting") continue
        if (run.canceled) {
          Object.assign(step, { status: "canceled" })
          changed = true
          continue
        }
        const needs = [...new Set(Object.values(s.values ?? {}).map(stepRef).filter(Boolean))]
        if (needs.some((n) => !TERMINAL.has(run.steps[n].status) && run.steps[n].status !== "skipped")) continue
        const missing = needs.find((n) => run.steps[n].status !== "done")
        if (missing) {
          Object.assign(step, { status: "skipped", error: `Skipped: “${labelOf(recipe, missing, this.apps)}” didn't work.` })
          changed = true
          continue
        }
        try {
          step.jobs = this.enqueueStep(run, s)
          step.status = "running"
        } catch (e) {
          Object.assign(step, { status: "failed", error: e.message })
        }
        changed = true
      }
    }
    const states = Object.values(run.steps).map((s) => s.status)
    run.status = states.some((s) => s === "waiting" || s === "running")
      ? "running"
      : run.canceled
        ? "canceled"
        : states.every((s) => s === "done")
          ? "done"
          : states.includes("done")
            ? "partial"
            : "failed"
    if (run.status !== "running") run.finishedAt ??= Date.now()
    this.store.put("runs", run)
    this.emit(run)
  }

  /** One job per combination of earlier results (and `each` values), each with `count` variations. */
  enqueueStep(run, s) {
    const text = (value) => String(value).replace(/\{\{([a-z0-9-]+)\}\}/g, (_, name) => String(run.inputs[name] ?? ""))
    const resolve = (value) => {
      const input = whole(value)
      if (input) return run.inputs[input]
      return typeof value === "string" ? text(value) : value
    }
    let combos = [{}]
    for (const [key, value] of Object.entries(s.values ?? {})) {
      const from = stepRef(value)
      const options = from ? run.steps[from].outputs : [resolve(value)]
      combos = combos.flatMap((c) => options.map((o) => ({ ...c, [key]: o })))
    }
    const [eachKey, eachValues] = Object.entries(s.each ?? {})[0] ?? []
    if (eachKey) combos = combos.flatMap((c) => eachValues.map((v) => ({ ...c, [eachKey]: resolve(v) })))
    const count = s.count ?? 1
    const label = `${run.title} · ${labelOf(run.recipe, s.id, this.apps)}`
    const meta = { source: s.keep === false ? "recipe-part" : "recipe", runId: run.id, stepId: s.id, label }
    return combos.slice(0, Math.max(1, Math.floor(MAX_JOBS_PER_STEP / count))).flatMap((values) => this.jobs.enqueue({ appId: s.app, values, count, meta }).map((j) => j.id))
  }

  emit(run) {
    this.events.emit("run", run)
  }

  trim() {
    const runs = this.store.list("runs").sort((a, b) => b.createdAt - a.createdAt)
    for (const r of runs.slice(KEEP_RUNS)) if (r.status !== "running") this.store.remove("runs", r.id)
  }
}

function labelOf(recipe, stepId, apps) {
  const s = recipe.steps.find((x) => x.id === stepId)
  return s?.label ?? apps.get(s?.app)?.label ?? stepId
}
