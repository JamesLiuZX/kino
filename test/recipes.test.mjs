// Recipes: the format's checks, and runs through the real HTTP API with the
// demo engine: steps that wait for earlier ones, fan out over their results and
// `each` values, keep in-between results out of the library, and cancel.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "../src/server.mjs"
import { MockProvider } from "../src/providers/mock.mjs"
import { hasFfmpeg } from "../src/media/ffmpeg.mjs"
import { Apps } from "../src/apps.mjs"
import { Store } from "../src/store.mjs"
import { recipeProblems } from "../src/recipes.mjs"

const ffmpeg = await hasFfmpeg()
const photo = readFileSync(new URL("../brands/herbalbath/product.jpg", import.meta.url))

async function start({ stepMs = 5 } = {}) {
  const { server } = createServer({ dataDir: mkdtempSync(join(tmpdir(), "kino-rec-")), env: {}, providerOverride: new MockProvider({ stepMs }) })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, { method = "GET", body, headers = {}, raw } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) })
    return { status: res.status, data: await res.json() }
  }
  const close = () => new Promise((r) => (server.closeAllConnections?.(), server.close(r)))
  return { call, close }
}

async function until(fn, ms = 30_000) {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("timed out")
}

const CHAIN = {
  kino: "recipe/1",
  id: "test-chain",
  title: "Test chain",
  inputs: [
    { id: "photo", type: "image", label: "Product photo" },
    { id: "scene", type: "text", label: "Scene", default: "on a teak table" },
  ],
  steps: [
    { id: "scenes", app: "edit", count: 2, keep: false, values: { image: "{{photo}}", prompt: "Place this product {{scene}}." } },
    { id: "sizes", label: "Sizes", app: "reframe", values: { image: "@scenes", fit: "white" }, each: { aspect: ["1:1", "9:16"] } },
  ],
}

test("recipe format: every built-in recipe checks out, and mistakes are named", () => {
  const apps = new Apps({ store: new Store(mkdtempSync(join(tmpdir(), "kino-rec-"))) })
  assert.deepEqual(recipeProblems(CHAIN, apps), [])
  const broken = (change) => recipeProblems({ ...CHAIN, ...change }, apps).join(" ")
  const steps = (...s) => ({ steps: s })
  assert.match(broken({ kino: "recipe/2" }), /"kino" must be "recipe\/1"/)
  assert.match(broken(steps({ id: "a", app: "nope", values: {} })), /no app called "nope"/)
  assert.match(broken(steps({ id: "a", app: "reframe", values: { image: "@later" } }, { id: "later", app: "cutout", values: { image: "{{photo}}" } })), /"@later" isn't an earlier step/)
  assert.match(broken(steps({ id: "a", app: "video-instant", values: { image: "{{photo}}" } }, { id: "b", app: "reframe", values: { image: "@a" } })), /"image" takes an image, and "a" makes a video/)
  assert.match(broken(steps({ id: "a", app: "reframe", values: { image: "{{scene}}" } })), /"image" takes an image, and "scene" is a text/)
  assert.match(broken(steps({ id: "a", app: "edit", values: { image: "{{photo}}" } })), /Edit with words needs "prompt"/)
  assert.match(broken(steps({ id: "a", app: "reframe", values: { image: "{{photo}}", aspect: "5:4" } })), /"aspect" is one of 1:1, 4:5, 3:4, 9:16, 16:9; "5:4" isn't/)
  assert.match(broken(steps({ id: "a", app: "reframe", values: { image: "{{photo}}", fit: "stretch" } })), /"fit" is one of fill, fit, white/)
  assert.match(broken(steps({ id: "scene", app: "cutout", values: { image: "{{photo}}" } })), /"scene" is already taken/)
  assert.match(broken(steps({ id: "a", app: "edit", values: { image: "{{photo}}", prompt: "Make it {{colour}}" } })), /"\{\{colour\}\}" isn't one of the inputs/)
  assert.match(broken(steps({ id: "a", app: "reframe", values: { image: "{{photo}}" }, each: { aspect: ["1:1"], fit: ["white"] } })), /"each" names one setting/)
})

test("recipes: a run waits for earlier steps, fans out over their results and each value, and keeps in-between results aside", { skip: !ffmpeg && "needs ffmpeg" }, async () => {
  const s = await start()
  try {
    const gallery = (await s.call("/api/recipes")).data
    assert.ok(gallery.length >= 6 && gallery.every((r) => r.builtin))
    assert.ok(gallery.some((r) => r.id === "marketplace-listing"))

    assert.equal((await s.call("/api/recipes", { method: "POST", body: { ...CHAIN, id: "camera-moves" } })).status, 400, "built-in ids are taken")
    const bad = await s.call("/api/recipes", { method: "POST", body: { ...CHAIN, steps: [] } })
    assert.equal(bad.status, 400)
    assert.match(bad.data.error, /"steps" is a list/)
    assert.equal((await s.call("/api/recipes", { method: "POST", body: CHAIN })).status, 200)

    const asset = (await s.call("/api/assets", { method: "POST", raw: photo, headers: { "Content-Type": "image/jpeg", "X-Filename": "bottle.jpg" } })).data
    assert.equal((await s.call("/api/recipes/test-chain/run", { method: "POST", body: { inputs: {} } })).data.error, "Add a product photo.")

    const started = (await s.call("/api/recipes/test-chain/run", { method: "POST", body: { inputs: { photo: asset.id, scene: "on a marble counter" } } })).data
    assert.equal(started.status, "running")
    assert.equal(started.steps.scenes.jobs.length, 2, "a job for each variation")
    assert.equal(started.steps.sizes.status, "waiting")

    const run = await until(async () => {
      const r = (await s.call(`/api/runs/${started.id}`)).data
      return r.status !== "running" && r
    })
    assert.equal(run.status, "done", JSON.stringify(run.steps))
    assert.equal(run.steps.scenes.outputs.length, 2)
    assert.equal(run.steps.sizes.jobs.length, 4, "two scenes × two sizes")
    assert.equal(run.steps.sizes.outputs.length, 4)

    const jobs = (await s.call("/api/jobs")).data
    const scene = jobs.find((j) => j.id === run.steps.scenes.jobs[0])
    assert.equal(scene.values.prompt, "Place this product on a marble counter.")
    assert.equal(scene.runId, run.id)

    const library = (await s.call("/api/assets")).data
    const sizes = run.steps.sizes.outputs.map((id) => library.find((a) => a.id === id))
    assert.ok(sizes.every((a) => a?.source === "recipe"), "results are in the library")
    assert.deepEqual(sizes.map((a) => (a.width === a.height ? "1:1" : a.height > a.width ? "9:16" : "?")).sort(), ["1:1", "1:1", "9:16", "9:16"])
    assert.ok(run.steps.scenes.outputs.every((id) => !library.some((a) => a.id === id)), "in-between results stay out of the main view")
    const parts = (await s.call("/api/assets?source=recipe-part")).data
    assert.ok(run.steps.scenes.outputs.every((id) => parts.some((a) => a.id === id)))

    assert.equal((await s.call("/api/runs?recipe=test-chain")).data.length, 1)
    assert.equal((await s.call("/api/recipes/test-chain", { method: "DELETE" })).data.ok, true)
    assert.equal((await s.call("/api/recipes/camera-moves", { method: "DELETE" })).status, 400, "built-ins stay")
  } finally {
    await s.close()
  }
})

test("recipes: cancelling a run stops its jobs and the steps waiting on them", async () => {
  const s = await start({ stepMs: 200 })
  try {
    await s.call("/api/recipes", { method: "POST", body: { ...CHAIN, id: "slow", inputs: [{ id: "words", type: "text", label: "Words", default: "a teapot" }], steps: [{ id: "pic", app: "image-fast", values: { prompt: "{{words}}" } }, { id: "square", app: "reframe", values: { image: "@pic", aspect: "1:1" } }] } })
    const run = (await s.call("/api/recipes/slow/run", { method: "POST", body: { inputs: {} } })).data
    const canceled = (await s.call(`/api/runs/${run.id}/cancel`, { method: "POST" })).data
    const done = await until(async () => {
      const r = (await s.call(`/api/runs/${run.id}`)).data
      return r.status !== "running" && r
    })
    assert.equal(done.status, "canceled", JSON.stringify(canceled.steps))
    assert.equal(done.steps.square.status, "canceled")
    assert.equal(done.steps.square.jobs.length, 0, "the waiting step never started")
    const job = (await s.call("/api/jobs")).data.find((j) => j.id === done.steps.pic.jobs[0])
    assert.equal(job.status, "canceled")
  } finally {
    await s.close()
  }
})
