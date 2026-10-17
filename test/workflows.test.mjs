import { test } from "node:test"
import assert from "node:assert/strict"
import { APPS } from "../apps/catalog.mjs"
import { loadRegistry, loadWorkflows, resolveValues } from "../src/apps.mjs"
import { checkBindings, fileInputs, instantiate } from "../src/comfy/graph.mjs"
import { uiToApi } from "../src/comfy/ui2api.mjs"
import { validatePrompt } from "../src/comfy/validate.mjs"
import { txt2imgUi } from "./fixtures.mjs"

const registry = loadRegistry()
const workflows = loadWorkflows()

test("every shipped workflow validates against ComfyUI 0.41's node definitions", () => {
  assert.ok(Object.keys(workflows).length >= 11)
  for (const [id, wf] of Object.entries(workflows)) {
    const v = validatePrompt(wf.prompt, registry)
    assert.deepEqual(v.errors, [], `${id}: ${v.errors.join("; ")}`)
    assert.ok(wf.models.length > 0, `${id} lists its model files`)
    assert.equal(wf.source.comfyui.version, registry.comfyui.version)
  }
})

test("every app's bindings point at real nodes and inputs", () => {
  for (const app of APPS.filter((a) => !a.local)) {
    assert.deepEqual(checkBindings(workflows[app.workflow], app.params), [], app.id)
  }
})

// Values a person could plausibly send: every file param filled, so optional
// "inject" wiring is exercised too.
function sample(app) {
  const v = {}
  for (const p of app.params) {
    if (p.type === "image") v[p.id] = `in_${p.id}.png`
    if (p.type === "audio") v[p.id] = `in_${p.id}.wav`
    if (p.type === "video") v[p.id] = `in_${p.id}.mp4`
    if (p.type === "prompt") v[p.id] = "a lantern-lit street in the rain"
  }
  v.seed = 4242
  return resolveValues(app, v)
}

test("instantiated apps stay valid, carry the person's values, and wire uploaded files", () => {
  for (const app of APPS.filter((a) => !a.local)) {
    const values = sample(app)
    const prompt = instantiate(workflows[app.workflow], app.params, values)
    const v = validatePrompt(prompt, registry)
    assert.deepEqual(v.errors, [], `${app.id}: ${v.errors.join("; ")}`)
    const json = JSON.stringify(prompt)
    if (app.params.some((p) => p.type === "seed")) assert.ok(json.includes("4242"), `${app.id} seed applied`)
    for (const p of app.params.filter((p) => ["image", "audio", "video"].includes(p.type))) {
      assert.ok(json.includes(`in_${p.id}`), `${app.id}: ${p.id} reaches the graph`)
    }
    const files = fileInputs(prompt).map((f) => f.name)
    for (const p of app.params.filter((p) => ["image", "audio", "video"].includes(p.type))) assert.ok(files.includes(`in_${p.id}.${{ image: "png", audio: "wav", video: "mp4" }[p.type]}`), `${app.id}: ${p.id} is uploaded`)
  }
})

test("optional inputs stay unwired when empty", () => {
  const app = APPS.find((a) => a.id === "video-pro")
  const wf = workflows[app.workflow]
  const withEnd = instantiate(wf, app.params, resolveValues(app, { image: "a.png", endImage: "b.png" }))
  const without = instantiate(wf, app.params, resolveValues(app, { image: "a.png" }))
  assert.ok(withEnd.kino_endImage, "end frame loader added")
  assert.equal(without.kino_endImage, undefined)
  assert.ok(Object.values(withEnd).some((n) => JSON.stringify(n.inputs).includes('["kino_endImage",0]')))
})

test("H3 receives a shot list with the camera move, sound and the start-frame reference", () => {
  const app = APPS.find((a) => a.id === "video-pro")
  const values = resolveValues(app, { image: "a.png", prompt: "steam curls from a cup", camera: "orbit", audio: "upbeat" })
  const prompt = instantiate(workflows[app.workflow], app.params, values)
  const text = JSON.stringify(prompt)
  assert.match(text, /<Picture 1>/)
  assert.match(text, /SHOT 1: steam curls from a cup; the camera arcs around the subject/)
  assert.match(text, /Audio: a bright, upbeat modern pop instrumental/)
})

test("UI-format workflows convert: control tokens, reroutes, primitives, bypass and notes", () => {
  const { prompt, warnings } = uiToApi(txt2imgUi(), registry)
  assert.deepEqual(warnings, [])
  assert.deepEqual(Object.keys(prompt).sort(), ["1", "2", "3", "4", "5", "6", "7"])
  assert.deepEqual(prompt["5"].inputs, {
    seed: 777,
    steps: 20,
    cfg: 7,
    sampler_name: "euler",
    scheduler: "normal",
    denoise: 1,
    model: ["1", 0],
    positive: ["2", 0],
    negative: ["3", 0],
    latent_image: ["4", 0],
  })
  assert.deepEqual(prompt["6"].inputs, { samples: ["5", 0], vae: ["1", 2] })
  assert.equal(prompt["2"]._meta.title, "Positive")
  assert.deepEqual(validatePrompt(prompt, registry).errors, [])
})
