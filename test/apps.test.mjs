import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appById } from "../apps/catalog.mjs"
import { Apps, describeApp, resolveValues } from "../src/apps.mjs"
import { instantiate } from "../src/comfy/graph.mjs"
import { validatePrompt } from "../src/comfy/validate.mjs"
import { h3Prompt, imagePrompt, wanPrompt } from "../src/prompt.mjs"
import { sizeFor } from "../src/presets.mjs"
import { Store } from "../src/store.mjs"
import { txt2imgApi, txt2imgUi } from "./fixtures.mjs"

const tmpStore = () => new Store(mkdtempSync(join(tmpdir(), "kino-apps-")))

test("resolveValues fills defaults, clamps ranges and rejects what can't run", () => {
  const app = appById("video-pro")
  const v = resolveValues(app, { image: "a1", duration: 99, camera: "nope", audio: "silent" }, { random: () => 0.5 })
  assert.equal(v.duration, 10)
  assert.equal(v.camera, "push-in")
  assert.equal(v.audio, "silent")
  assert.equal(v.quality, "fast")
  assert.equal(v.prompt, "")
  assert.equal(v.seed, 2 ** 31)
  assert.throws(() => resolveValues(app, {}), /Add a start frame/)
  assert.throws(() => resolveValues(appById("image-fast"), { prompt: "  " }), /Write a prompt first/)
  assert.throws(() => resolveValues(appById("edit"), { image: "x" }), /Describe the change/)
  assert.throws(() => resolveValues(app, { image: "gone" }, { assetExists: () => false }), /no longer in your library/)
})

test("derived sizes follow the aspect, at ResolutionSelector's arithmetic", () => {
  const v = resolveValues(appById("image-fast"), { prompt: "x", aspect: "9:16" })
  assert.deepEqual([v.width, v.height], [sizeFor("9:16").width, sizeFor("9:16").height])
  assert.equal(v.width % 64, 0)
  assert.ok(Math.abs((v.width * v.height) / 1024 ** 2 - 1) < 0.1)
})

test("a locked seed is kept; an empty one is random", () => {
  const app = appById("image-fast")
  assert.equal(resolveValues(app, { prompt: "x", seed: 7 }).seed, 7)
  assert.notEqual(resolveValues(app, { prompt: "x" }, { random: () => 0.1 }).seed, resolveValues(app, { prompt: "x" }, { random: () => 0.9 }).seed)
})

test("prompt builders speak each model's dialect", () => {
  assert.equal(imagePrompt("a fox.  ", "none"), "a fox")
  assert.match(imagePrompt("a fox", "cinematic"), /^a fox, cinematic film still/)
  const h3 = h3Prompt({ prompt: "she smiles", camera: "push-in", audio: "warm-zh", hasImage: true, hasEndImage: true, style: "ugc" })
  assert.deepEqual(h3.split("\n").map((l) => l.split(":")[0].split(" ").slice(0, 2).join(" ")), ["The video", "It ends", "SHOT 1", "Look", "Audio"])
  assert.match(h3, /It ends exactly on <Picture 2>/)
  const shots = h3Prompt({ shots: [{ text: "a", camera: "static" }, { text: "b", camera: "orbit" }], audio: "ambient" })
  assert.match(shots, /SHOT 2: b; the camera arcs/)
  assert.match(wanPrompt({ prompt: "rain", camera: "pan-left" }), /^rain\. the camera pans smoothly to the left\.$/)
})

test("importing an API-format workflow finds the prompt, negative, size, files and seed", () => {
  const apps = new Apps({ store: tmpStore() })
  const { app, warnings } = apps.importWorkflow({ name: "SDXL portrait", workflow: txt2imgApi() })
  assert.deepEqual(warnings, [])
  const byId = Object.fromEntries(app.params.map((p) => [p.id, p]))
  assert.equal(byId.prompt.bind, "node:2.text")
  assert.equal(byId.negative.bind, "node:3.text")
  assert.equal(byId.negative.default, "blurry, watermark")
  assert.equal(byId.image_1.bind, "node:8.image")
  assert.equal(byId.image_1.label, "Reference")
  assert.equal(byId.aspect.default, "3:2")
  assert.equal(byId.seed.bind, "seeds")
  assert.equal(app.output, "image")
  assert.equal(apps.get(app.id).label, "SDXL portrait")

  // And it runs: values flow into the graph, the size follows the aspect.
  const values = resolveValues(app, { prompt: "an otter", image_1: "up.png", aspect: "9:16", seed: 5 })
  const prompt = instantiate(app.workflowData, app.params, values)
  assert.equal(prompt["2"].inputs.text, "an otter")
  assert.equal(prompt["5"].inputs.seed, 5)
  assert.ok(prompt["4"].inputs.height > prompt["4"].inputs.width)
  assert.equal(prompt["8"].inputs.image, "up.png")
  assert.deepEqual(validatePrompt(prompt, apps.registry).errors, [])
  assert.ok(describeApp(app).params.every((p) => typeof p.map === "undefined"))
})

test("importing a UI-format workflow converts it first", () => {
  const apps = new Apps({ store: tmpStore() })
  const { app } = apps.importWorkflow({ name: "From the editor", workflow: txt2imgUi() })
  assert.ok(app.params.some((p) => p.id === "prompt"))
  assert.ok(app.params.some((p) => p.id === "seed"))
})

test("custom nodes: API format imports with a warning, UI format asks for the API export", () => {
  const apps = new Apps({ store: tmpStore() })
  const api = txt2imgApi()
  api[7] = { class_type: "VHS_VideoCombine", inputs: { images: ["6", 0], frame_rate: 24 } }
  const { app, warnings } = apps.importWorkflow({ name: "With VHS", workflow: api })
  assert.match(warnings.join(" "), /VHS_VideoCombine/)
  assert.equal(app.output, "video")
  const ui = txt2imgUi()
  ui.nodes.push({ id: 40, type: "SomeCustomNode", mode: 0, inputs: [], widgets_values: [] })
  assert.throws(() => apps.importWorkflow({ name: "x", workflow: ui }), /Export \(API\)/)
  assert.throws(() => apps.importWorkflow({ name: "x", workflow: { hello: "world" } }), /isn't a ComfyUI workflow/)
})
