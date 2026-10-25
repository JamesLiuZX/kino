import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "../src/server.mjs"
import { MockProvider } from "../src/providers/mock.mjs"
import { hasFfmpeg } from "../src/media/ffmpeg.mjs"
import { txt2imgApi } from "./fixtures.mjs"

const ffmpeg = await hasFfmpeg()

async function start({ env = {}, dataDir = mkdtempSync(join(tmpdir(), "kino-srv-")) } = {}) {
  const { server, ctx } = createServer({ dataDir, env, providerOverride: new MockProvider({ stepMs: 5 }) })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (path, { method = "GET", body, headers = {}, raw } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined && !raw ? { "Content-Type": "application/json" } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    return { status: res.status, data, headers: res.headers }
  }
  const close = () => new Promise((r) => (server.closeAllConnections?.(), server.close(r)))
  return { base, call, close, ctx, dataDir }
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

const photo = readFileSync(new URL("../brands/herbalbath/product.jpg", import.meta.url))

test("bootstrap describes tools, apps and presets, and never leaks secrets", async () => {
  const s = await start({ env: { ANTHROPIC_API_KEY: "sk-ant-secret-1234" } })
  try {
    const { data } = await s.call("/api/bootstrap")
    assert.deepEqual(data.tools.map((t) => t.id), ["image", "video", "edit", "cutout", "talk", "enhance"])
    assert.ok(data.apps.every((a) => a.params.every((p) => !("bind" in p) && !("map" in p))))
    assert.equal(data.presets.camera.length, 20)
    assert.ok(!JSON.stringify(data).includes("sk-ant-secret-1234"))
    assert.deepEqual(data.settings.anthropicKey, { set: true, hint: "…1234", locked: true })
    assert.equal(data.ads.brands[0].id, "herbalbath")
  } finally {
    await s.close()
  }
})

test("upload, generate variations, stream events, serve files with ranges", async () => {
  const s = await start()
  const events = []
  const ac = new AbortController()
  try {
    const sse = await fetch(`${s.base}/api/events`, { signal: ac.signal })
    ;(async () => {
      const dec = new TextDecoder()
      for await (const chunk of sse.body) events.push(...dec.decode(chunk).split("\n").filter((l) => l.startsWith("event:")).map((l) => l.slice(7)))
    })().catch(() => {})

    const up = await s.call("/api/assets", { method: "POST", raw: photo, headers: { "Content-Type": "image/jpeg", "X-Filename": "bottle.jpg" } })
    assert.equal(up.status, 200)
    assert.deepEqual([up.data.width, up.data.height], [1200, 1200])
    assert.ok(up.data.thumbUrl.startsWith("/thumbs/") || !ffmpeg)

    const gen = await s.call("/api/generate", { method: "POST", body: { app: "image-fast", values: { prompt: "a teapot", aspect: "1:1" }, count: 2 } })
    assert.equal(gen.data.jobs.length, 2)
    assert.notEqual(gen.data.jobs[0].values.seed, gen.data.jobs[1].values.seed)
    const done = await until(async () => {
      const { data } = await s.call("/api/jobs")
      const mine = data.filter((j) => gen.data.jobs.some((g) => g.id === j.id))
      return mine.every((j) => j.status === "done") && mine
    })
    const assets = (await s.call("/api/assets")).data
    for (const j of done) {
      const a = assets.find((x) => x.id === j.outputs[0])
      assert.equal(a.kind, "image")
      assert.equal(a.demo, true)
      assert.equal(a.prompt, "a teapot")
    }
    const ranged = await fetch(s.base + assets[0].url, { headers: { Range: "bytes=0-15" } })
    assert.equal(ranged.status, 206)
    assert.equal((await ranged.arrayBuffer()).byteLength, 16)
    assert.ok(events.includes("job") && events.includes("asset"))

    const bad = await s.call("/api/generate", { method: "POST", body: { app: "edit", values: { prompt: "make it blue" } } })
    assert.equal(bad.status, 400)
    assert.match(bad.data.error, /Add a photo/)
  } finally {
    ac.abort()
    await s.close()
  }
})

test("live previews go to the browser a few times a second and are never stored", async () => {
  // Demo pictures send a frame with every step, the way This computer's engine does.
  const dataDir = mkdtempSync(join(tmpdir(), "kino-srv-"))
  const { server } = createServer({ dataDir, env: {}, providerOverride: new MockProvider({ stepMs: 60 }) })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  const ac = new AbortController()
  const previews = []
  try {
    const sse = await fetch(`${base}/api/events`, { signal: ac.signal })
    ;(async () => {
      const dec = new TextDecoder()
      let buf = ""
      for await (const chunk of sse.body) {
        buf += dec.decode(chunk)
        for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
          const block = buf.slice(0, i)
          if (block.startsWith("event: preview")) previews.push(JSON.parse(block.split("\ndata: ")[1]))
        }
      }
    })().catch(() => {})
    const gen = await (await fetch(`${base}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: "image-fast", values: { prompt: "a teapot" } }) })).json()
    const id = gen.jobs[0].id
    const job = await until(async () => (await (await fetch(`${base}/api/jobs`)).json()).find((j) => j.id === id && j.status === "done"))
    assert.ok(previews.length >= 2, `frames arrive while it works (${previews.length})`)
    assert.ok(previews.length < 8, `at most four a second, not one per step (${previews.length} for 10 steps)`)
    assert.ok(previews.every((p) => p.id === id && p.url.startsWith("data:image/png;base64,")))
    assert.ok(!JSON.stringify(job).includes("data:image"), "the job record carries no frames")
  } finally {
    ac.abort()
    await new Promise((r) => (server.closeAllConnections?.(), server.close(r)))
  }
})

test("instant camera moves render real video from a photo", { skip: !ffmpeg && "ffmpeg not installed" }, async () => {
  const s = await start()
  try {
    const up = await s.call("/api/assets", { method: "POST", raw: photo, headers: { "Content-Type": "image/jpeg", "X-Filename": "bottle.jpg" } })
    const gen = await s.call("/api/generate", { method: "POST", body: { app: "video-instant", values: { image: up.data.id, camera: "orbit", aspect: "9:16", duration: 2 } } })
    const job = await until(async () => (await s.call("/api/jobs")).data.find((j) => j.id === gen.data.jobs[0].id && j.status === "done"))
    const asset = (await s.call("/api/assets")).data.find((a) => a.id === job.outputs[0])
    assert.equal(asset.kind, "video")
    assert.deepEqual([asset.width, asset.height], [720, 1280])
    assert.deepEqual(asset.parents, [up.data.id])
  } finally {
    await s.close()
  }
})

test("queued jobs can be cancelled and retried", async () => {
  const s = await start()
  try {
    const gen = await s.call("/api/generate", { method: "POST", body: { app: "image-fast", values: { prompt: "x" }, count: 4 } })
    const last = gen.data.jobs[3]
    const c = await s.call(`/api/jobs/${last.id}/cancel`, { method: "POST" })
    assert.equal(c.data.status, "canceled")
    const r = await s.call(`/api/jobs/${last.id}/retry`, { method: "POST" })
    assert.equal(r.data.values.seed, last.values.seed, "retry keeps the seed")
    await until(async () => (await s.call("/api/jobs")).data.find((j) => j.id === r.data.id)?.status === "done")
  } finally {
    await s.close()
  }
})

test("settings: secrets are write-only and a bad backend is reported, not fatal", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kino-set-"))
  const { server, ctx } = createServer({ dataDir, env: {} })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const put = await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "runpod", runpodKey: "rpa_abcdef9876" }) })
    const saved = await put.json()
    assert.deepEqual(saved.runpodKey, { set: true, hint: "…9876", locked: false })
    assert.ok(!JSON.stringify(saved).includes("rpa_abcdef9876"))
    const boot = await (await fetch(`${base}/api/bootstrap`)).json()
    assert.match(boot.provider.error, /endpoint ID and API key/)
    // An untouched secret field (null) keeps the saved value.
    await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runpodKey: null, runpodEndpoint: "ep42" }) })
    assert.equal(ctx.settings.get("runpodKey"), "rpa_abcdef9876")
    const after = await (await fetch(`${base}/api/bootstrap`)).json()
    assert.deepEqual([after.provider.id, after.provider.error], ["runpod", undefined])
    assert.match(after.provider.label, /RunPod endpoint ep42/)
  } finally {
    await new Promise((r) => (server.closeAllConnections?.(), server.close(r)))
  }
})

test("an access code protects the API and files", async () => {
  const s = await start({ env: { KINO_TOKEN: "open-sesame" } })
  try {
    assert.equal((await s.call("/api/bootstrap")).status, 401)
    assert.equal((await s.call("/api/login", { method: "POST", body: { token: "nope" } })).status, 401)
    const ok = await s.call("/api/login", { method: "POST", body: { token: "open-sesame" } })
    const cookie = ok.headers.get("set-cookie").split(";")[0]
    assert.match(ok.headers.get("set-cookie"), /HttpOnly/)
    assert.equal((await s.call("/api/bootstrap", { headers: { Cookie: cookie } })).status, 200)
    assert.equal((await s.call("/api/bootstrap", { headers: { Authorization: "Bearer open-sesame" } })).status, 200)
    assert.equal((await fetch(`${s.base}/files/anything.png`)).status, 401)
    assert.equal((await fetch(`${s.base}/`)).status, 200, "the app shell itself loads, to show the login")
    assert.deepEqual(await (await fetch(`${s.base}/healthz`)).json(), { ok: true }, "health checks need no code and learn nothing")
  } finally {
    await s.close()
  }
})

test("imported workflows become apps you can run", async () => {
  const s = await start()
  try {
    const imp = await s.call("/api/apps/import", { method: "POST", body: { name: "SDXL", workflow: txt2imgApi() } })
    assert.equal(imp.status, 200)
    const boot = (await s.call("/api/bootstrap")).data
    assert.ok(boot.tools.some((t) => t.id === "custom"))
    assert.ok(boot.apps.some((a) => a.id === imp.data.app.id))
    const up = await s.call("/api/assets", { method: "POST", raw: photo, headers: { "Content-Type": "image/jpeg", "X-Filename": "ref.jpg" } })
    const gen = await s.call("/api/generate", { method: "POST", body: { app: imp.data.app.id, values: { prompt: "a heron", image_1: up.data.id } } })
    await until(async () => (await s.call("/api/jobs")).data.find((j) => j.id === gen.data.jobs[0].id)?.status === "done")
    const wf = await fetch(`${s.base}/api/apps/${imp.data.app.id}/workflow`)
    assert.equal(JSON.parse(await wf.text())["2"].class_type, "CLIPTextEncode")
  } finally {
    await s.close()
  }
})

test("jobs that were running when the studio stopped are marked failed on start", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kino-restart-"))
  writeFileSync(join(dataDir, "kino.json"), JSON.stringify({ jobs: { j_old: { id: "j_old", appId: "image-fast", status: "running", values: {}, createdAt: 1 } } }))
  const s = await start({ dataDir })
  try {
    const job = (await s.call("/api/jobs")).data.find((j) => j.id === "j_old")
    assert.equal(job.status, "failed")
    assert.match(job.error, /restarted/)
  } finally {
    await s.close()
  }
})

test("Ad Studio: script, shots and a finished ad, end to end", { skip: !ffmpeg && "ffmpeg not installed" }, async () => {
  const s = await start()
  try {
    const draft = await s.call("/api/ads/draft", { method: "POST", body: { brandId: "herbalbath", platform: "tiktok", language: "zh", angles: ["offer"] } })
    assert.equal(draft.data.source, "templates")
    const brief = draft.data.briefs[0]
    assert.deepEqual(brief.issues, [])
    brief.shots = brief.shots.slice(0, 3).map((x) => ({ ...x, seconds: 2 }))
    const ad = (await s.call("/api/ads", { method: "POST", body: { brandId: "herbalbath", brief, engine: "instant" } })).data
    assert.ok(ad.productAssetId && ad.cutoutAssetId)
    await s.call(`/api/ads/${ad.id}/make`, { method: "POST", body: {} })
    const done = await until(async () => {
      const a = (await s.call(`/api/ads/${ad.id}`)).data
      if (a.status === "failed") throw new Error(a.error)
      return a.status === "done" && a
    }, 120_000)
    const out = (await s.call("/api/assets?source=ad")).data.find((x) => x.id === done.outputAssetId)
    assert.deepEqual([out.width, out.height], [1080, 1920])
    assert.ok(Math.abs(out.duration - (6 + brief.endCard.seconds)) < 0.2)
    // Ad parts stay out of the main library.
    const main = (await s.call("/api/assets")).data
    assert.ok(main.every((a) => a.source !== "ad-part"))

    // Blocking issues need explicit confirmation.
    const risky = structuredClone(brief)
    risky.hook = "治愈关节痛"
    const ad2 = (await s.call("/api/ads", { method: "POST", body: { brandId: "herbalbath", brief: risky } })).data
    const refused = await s.call(`/api/ads/${ad2.id}/make`, { method: "POST", body: {} })
    assert.equal(refused.status, 409)
  } finally {
    await s.close()
  }
})
