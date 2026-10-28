// Wires the studio together and serves it: the single-page app, the files, and
// a small JSON API with a server-sent event stream for live progress.

import { EventEmitter } from "node:events"
import { createServer as createHttpServer } from "node:http"
import { timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Store } from "./store.mjs"
import { Settings } from "./settings.mjs"
import { Apps, catalogue } from "./apps.mjs"
import { Library, assetView } from "./library.mjs"
import { Jobs } from "./jobs.mjs"
import { providerFor } from "./providers/index.mjs"
import { Engine } from "./engine/index.mjs"
import { claudeStatus, enhancePrompt } from "./llm.mjs"
import { AdStudio, ENGINES } from "./ads/studio.mjs"
import { Recipes } from "./recipes.mjs"
import { builtinRecipes } from "./recipe-files.mjs"
import { Posts, PLATFORMS as POST_PLATFORMS, postText } from "./posts.mjs"
import { PLATFORMS, platformById } from "./ads/platforms.mjs"
import { ANGLES } from "./ads/schema.mjs"
import { renderMotion } from "./media/motion.mjs"
import { reframeFilter, reframeSize } from "./media/reframe.mjs"
import { hasFfmpeg, probe, run } from "./media/ffmpeg.mjs"
import { attachment, safeNames, writeZip } from "./media/zip.mjs"
import { HttpError, Router, parseCookies, readBody, readJson, send, serveFile } from "./http.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const PUBLIC = join(ROOT, "public")
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version

/**
 * settingsDefaults overrides built-in defaults (the desktop app starts on
 * "local"); the engine folder is <dataDir>/engine unless KINO_ENGINE_DIR or
 * engineDir say otherwise.
 */
export function createStudio({ dataDir, env = process.env, providerOverride, settingsDefaults, engineDir, engineOptions = {} } = {}) {
  const events = new EventEmitter()
  events.setMaxListeners(100)
  const store = new Store(dataDir)
  const settings = new Settings(dataDir, env, { defaults: settingsDefaults })
  const apps = new Apps({ store })
  const library = new Library({ store, dir: dataDir, events })
  const engine = new Engine({ dir: engineDir ?? env.KINO_ENGINE_DIR ?? join(dataDir, "engine"), settings, ...engineOptions })
  const pick = providerOverride ? () => providerOverride : (s) => providerFor(s, { engine })
  let studio
  const jobs = new Jobs({
    store,
    apps,
    library,
    settings,
    events,
    dataDir,
    providerFor: pick,
    local: {
      motion: async ({ values, inputs, workDir, onProgress }) => {
        if (!(await hasFfmpeg())) throw new Error("Instant camera moves need ffmpeg installed on this machine.")
        onProgress(0.2, "Moving the camera")
        const out = join(workDir, "motion.mp4")
        await renderMotion({ image: inputs.image, out, camera: values.camera, aspect: values.aspect, duration: values.duration })
        return [{ path: out, filename: "motion.mp4", mime: "video/mp4" }]
      },
      reframe: async ({ values, inputs, workDir, onProgress, signal }) => {
        if (!(await hasFfmpeg())) throw new Error("Reframing needs ffmpeg installed on this machine.")
        onProgress(0.3, "Reframing")
        const { width, height } = await probe(inputs.image)
        const size = reframeSize({ width, height, aspect: values.aspect, fit: values.fit })
        // Cropping a cut-out keeps it transparent; everything else is a JPEG.
        const png = values.fit === "fill" && /^\.(png|webp)$/i.test(extname(inputs.image))
        const out = join(workDir, png ? "reframed.png" : "reframed.jpg")
        await run("ffmpeg", ["-y", "-v", "error", "-i", inputs.image, "-filter_complex", reframeFilter({ ...size, fit: values.fit }), "-map", "[out]", "-frames:v", "1", ...(png ? [] : ["-q:v", "2"]), out], { signal })
        return [{ path: out, filename: basename(out), mime: png ? "image/png" : "image/jpeg" }]
      },
      "ad-render": (ctx) => studio.runRender(ctx),
    },
  })
  studio = new AdStudio({ store, library, jobs, settings, events })
  const recipes = new Recipes({ store, apps, jobs, library, events, builtin: builtinRecipes() })
  const posts = new Posts({ store, library, settings, events, brandFor: (post) => (post.from?.adId ? studio.brand(studio.get(post.from.adId)?.brandId ?? "") : null) })
  jobs.start()
  posts.start()
  // Brand photos go into the library up front, so the Ad Studio can show them.
  for (const b of studio.brands()) studio.brandAssets(b).catch((e) => console.error("[kino] brand assets:", e.message))
  return { events, store, settings, apps, library, jobs, studio, recipes, posts, engine, provider: () => pick(settings) }
}

export function createServer({ dataDir, env = process.env, ...options } = {}) {
  const ctx = createStudio({ dataDir, env, ...options })
  const { events, store, settings, apps, library, jobs, studio, recipes, posts, engine } = ctx
  const token = env.KINO_TOKEN || ""
  const maxUpload = Number(env.KINO_MAX_UPLOAD_MB || 300) * 1024 * 1024
  const r = new Router()

  // ------------------------------------------------------------ bootstrap
  r.on("GET", "/api/bootstrap", async () => {
    const provider = safeProvider(ctx)
    return {
      version: VERSION,
      ...catalogue(apps),
      settings: settings.public(),
      provider: { id: provider.id, label: provider.label, error: provider.error },
      claude: await claudeStatus(settings),
      ffmpeg: await hasFfmpeg(),
      engine: engine.status(),
      ads: { platforms: Object.values(PLATFORMS), engines: ENGINES, angles: ANGLES, brands: studio.brands().map(brandView) },
      posting: { platforms: POST_PLATFORMS, webhook: !!posts.webhook() },
    }
  })

  r.on("GET", "/api/status", async () => {
    const provider = safeProvider(ctx)
    if (provider.error) return { ok: false, label: provider.error, apps: {} }
    const modelsByApp = Object.fromEntries(apps.list().filter((a) => !a.local).map((a) => [a.id, apps.modelsFor(a)]))
    try {
      return await provider.status(modelsByApp)
    } catch (e) {
      return { ok: false, label: e.message, apps: {} }
    }
  })

  // ------------------------------------------------------------ assets
  r.on("GET", "/api/assets", ({ query }) => {
    const source = query.get("source") || undefined
    const rows = library.list({
      kind: query.get("kind") || undefined,
      source,
      favorite: query.get("favorite") === "1",
      q: query.get("q") || undefined,
      limit: Number(query.get("limit")) || 120,
      before: Number(query.get("before")) || undefined,
    })
    // Parts (an ad's stills and clips, a recipe's in-between steps) stay out of the main library.
    return rows.filter((a) => source || (a.source !== "ad-part" && a.source !== "recipe-part")).map(assetView)
  })

  r.on("POST", "/api/assets", async ({ req }) => {
    const mime = String(req.headers["content-type"] ?? "").split(";")[0]
    const filename = decodeURIComponent(String(req.headers["x-filename"] ?? "upload"))
    const data = await readBody(req, maxUpload)
    if (!data.length) throw new HttpError(400, "The file is empty.")
    return assetView(await library.add({ data, mime, filename, source: "upload" }))
  })

  r.on("PATCH", "/api/assets/:id", async ({ req, params }) => {
    const row = library.patch(params.id, await readJson(req))
    if (!row) throw new HttpError(404, "That file is gone.")
    return assetView(row)
  })

  r.on("DELETE", "/api/assets/:id", async ({ params }) => ({ ok: await library.remove(params.id) }))

  // ------------------------------------------------------------ jobs
  r.on("GET", "/api/jobs", () => jobs.list({ limit: 200 }))

  r.on("POST", "/api/generate", async ({ req }) => {
    const { app, values, count } = await readJson(req)
    try {
      return { jobs: jobs.enqueue({ appId: app, values, count }) }
    } catch (e) {
      throw new HttpError(400, e.message)
    }
  })

  r.on("POST", "/api/jobs/:id/cancel", ({ params }) => jobs.cancel(params.id) ?? { ok: false })
  r.on("POST", "/api/jobs/:id/retry", ({ params }) => jobs.retry(params.id))
  r.on("DELETE", "/api/jobs/:id", ({ params }) => ({ ok: jobs.remove(params.id) }))

  // ------------------------------------------------------------ settings
  r.on("GET", "/api/settings", () => settings.public())
  r.on("PUT", "/api/settings", async ({ req }) => {
    try {
      const out = settings.update(await readJson(req))
      events.emit("settings", out)
      return out
    } catch (e) {
      throw new HttpError(400, e.message)
    }
  })

  // ------------------------------------------------------------ this computer
  r.on("GET", "/api/engine", () => {
    engine.refreshSizes()
    return engine.status()
  })
  r.on("POST", "/api/engine/install", async ({ req }) => wrap400(async () => engine.install(await readJson(req))))
  r.on("POST", "/api/engine/packs/:id/download", ({ params }) => wrap400(async () => engine.downloadPack(params.id)))
  r.on("POST", "/api/engine/packs/:id/cancel", ({ params }) => engine.cancel(params.id))
  r.on("DELETE", "/api/engine/packs/:id", ({ params }) => wrap400(() => engine.removePack(params.id)))
  r.on("POST", "/api/engine/install/cancel", () => engine.cancel("install"))
  r.on("POST", "/api/engine/setup", async ({ req }) => wrap400(async () => engine.setup(await readJson(req))))
  r.on("POST", "/api/engine/setup/cancel", () => engine.cancelSetup())
  r.on("POST", "/api/engine/stop", async () => {
    await engine.stopServer()
    return engine.status()
  })

  // ------------------------------------------------------------ writing help
  r.on("POST", "/api/enhance", async ({ req }) => {
    const { tool, prompt, imageAssetId, camera, style } = await readJson(req)
    const asset = imageAssetId ? library.get(imageAssetId) : null
    const image = asset?.kind === "image" ? (asset.thumb ? join(library.thumbsDir, asset.thumb) : asset.bytes < 4_500_000 ? library.pathOf(asset) : null) : null
    return enhancePrompt(settings, { tool, prompt, image, camera, style })
  })

  // ------------------------------------------------------------ apps
  r.on("POST", "/api/apps/import", async ({ req }) => {
    const { name, tool, workflow } = await readJson(req, 20 * 1024 * 1024)
    let objectInfo
    const provider = safeProvider(ctx)
    if (provider.id === "comfy" && provider.objectInfo && workflow && Array.isArray(workflow.nodes)) objectInfo = await provider.objectInfo().catch(() => undefined)
    try {
      const { app, warnings } = apps.importWorkflow({ name, tool, workflow, objectInfo })
      events.emit("apps", {})
      return { app: catalogue(apps).apps.find((a) => a.id === app.id), warnings }
    } catch (e) {
      throw new HttpError(400, e.message)
    }
  })

  r.on("DELETE", "/api/apps/:id", ({ params }) => {
    const ok = apps.remove(params.id)
    if (ok) events.emit("apps", {})
    return { ok }
  })

  r.on("GET", "/api/models", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "runpod", "models.json"), "utf8"))
    const byWorkflow = Object.fromEntries(apps.list().filter((a) => !a.local && !a.custom).map((a) => [a.workflow, a.id]))
    return { ...manifest, models: manifest.models.map((m) => ({ ...m, apps: m.usedBy.map((w) => byWorkflow[w]).filter(Boolean) })) }
  })

  r.on("GET", "/api/apps/:id/workflow", ({ params, res }) => {
    const app = apps.get(params.id)
    if (!app || app.local) throw new HttpError(404, "That app has no ComfyUI workflow.")
    const prompt = apps.workflowFor(app).prompt
    send(res, 200, JSON.stringify(prompt, null, 2), { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${app.id}-api.json"` })
  })

  // ------------------------------------------------------------ recipes
  r.on("GET", "/api/recipes", () => recipes.list())
  r.on("GET", "/api/recipes/:id", ({ params }) => recipes.get(params.id) ?? notFound("That recipe is gone."))
  r.on("POST", "/api/recipes", async ({ req }) => wrap400(() => readJson(req).then((b) => recipes.save(b))))
  r.on("DELETE", "/api/recipes/:id", ({ params }) => wrap400(async () => ({ ok: recipes.remove(params.id) })))
  r.on("POST", "/api/recipes/:id/run", async ({ req, params }) => wrap400(() => readJson(req).then((b) => recipes.start(params.id, b.inputs))))
  r.on("GET", "/api/runs", ({ query }) => recipes.runs({ recipeId: query.get("recipe") || undefined }))
  r.on("GET", "/api/runs/:id", ({ params }) => recipes.getRun(params.id) ?? notFound("That run is gone."))
  r.on("POST", "/api/runs/:id/cancel", ({ params }) => wrap400(async () => recipes.cancel(params.id)))
  r.on("DELETE", "/api/runs/:id", ({ params }) => ({ ok: recipes.removeRun(params.id) }))
  r.on("GET", "/api/runs/:id/zip", async ({ params, res }) => {
    const run = recipes.getRun(params.id) ?? notFound("That run is gone.")
    const entries = []
    const made = []
    for (const s of run.recipe.steps) {
      if (s.keep === false) continue
      const outputs = run.steps[s.id].outputs.map((id) => library.get(id)).filter(Boolean)
      for (const [i, a] of outputs.entries()) {
        entries.push({ name: `${s.label ?? s.id}${outputs.length > 1 ? ` ${i + 1}` : ""}${extname(a.file)}`, path: library.pathOf(a) })
        made.push({ step: s.label ?? s.id, app: a.appId, prompt: a.prompt || undefined, width: a.width, height: a.height, duration: a.duration || undefined })
      }
    }
    if (!entries.length) throw new HttpError(400, "This run has nothing to download yet.")
    const names = safeNames(entries.map((e) => e.name))
    entries.forEach((e, i) => ((e.name = names[i]), (made[i].file = names[i])))
    const words = Object.fromEntries(Object.entries(run.inputs).filter(([, v]) => typeof v === "string" && !library.get(v)))
    entries.push({ name: "kino.json", data: JSON.stringify({ kino: "run/1", recipe: run.recipeId, title: run.title, made: new Date(run.createdAt).toISOString(), inputs: words, files: made }, null, 2) + "\n" })
    await sendZip(res, `${run.title} ${new Date(run.createdAt).toISOString().slice(0, 10)}.zip`, entries)
  })

  // ------------------------------------------------------------ posts
  r.on("GET", "/api/posts", () => posts.list())
  r.on("POST", "/api/posts", async ({ req }) => wrap400(() => readJson(req).then((b) => posts.create(b))))
  r.on("POST", "/api/posts/test", () => wrap400(() => posts.test()))
  r.on("PUT", "/api/posts/:id", async ({ req, params }) => wrap400(() => readJson(req).then((b) => posts.update(params.id, b))))
  r.on("POST", "/api/posts/:id/schedule", async ({ req, params }) => wrap400(() => readJson(req).then((b) => posts.schedule(params.id, b.at))))
  r.on("POST", "/api/posts/:id/unschedule", ({ params }) => wrap400(async () => posts.unschedule(params.id)))
  r.on("POST", "/api/posts/:id/send", ({ params }) => wrap400(() => posts.sendNow(params.id)))
  r.on("POST", "/api/posts/:id/posted", ({ params }) => wrap400(async () => posts.markPosted(params.id)))
  r.on("DELETE", "/api/posts/:id", ({ params }) => ({ ok: posts.remove(params.id) }))
  r.on("GET", "/api/posts/:id/zip", async ({ params, res }) => {
    const post = posts.get(params.id) ?? notFound("That post is gone.")
    const media = post.media.map((id) => library.get(id)).filter(Boolean)
    const entries = media.map((a, i) => ({ name: `${post.title || "post"}${media.length > 1 ? ` ${i + 1}` : ""}${extname(a.file)}`, path: library.pathOf(a) }))
    entries.push({ name: "post.txt", data: `${postText(post)}\n` })
    await sendZip(res, `${post.title || "Kino post"}.zip`, entries)
  })

  // ------------------------------------------------------------ ads
  r.on("GET", "/api/brands", () => studio.brands().map(brandView))
  r.on("PUT", "/api/brands/:id", async ({ req, params }) => brandView(studio.saveBrand(params.id, await readJson(req))))

  r.on("GET", "/api/ads", () => studio.list())
  r.on("GET", "/api/ads/:id", ({ params }) => studio.get(params.id) ?? notFound("That ad is gone."))
  r.on("POST", "/api/ads/draft", async ({ req }) => wrap400(() => readJson(req).then((b) => studio.draft(b))))
  r.on("POST", "/api/ads", async ({ req }) => wrap400(() => readJson(req).then((b) => studio.create(b))))
  r.on("PUT", "/api/ads/:id", async ({ req, params }) => wrap400(() => readJson(req).then((b) => studio.update(params.id, b))))
  r.on("POST", "/api/ads/:id/make", async ({ req, params }) => wrap400(() => readJson(req).then((b) => studio.make(params.id, b))))
  r.on("POST", "/api/ads/:id/render", async ({ req, params }) => wrap400(() => readJson(req).then((b) => studio.render(params.id, b))))
  r.on("POST", "/api/ads/:id/shots/:shot/retry", async ({ params }) => wrap400(async () => studio.retryShot(params.id, params.shot)))
  r.on("DELETE", "/api/ads/:id", ({ params }) => ({ ok: studio.remove(params.id) }))
  // Every size made, the post text and the script, ready to upload anywhere.
  r.on("GET", "/api/ads/:id/zip", async ({ params, res }) => {
    const ad = studio.get(params.id) ?? notFound("That ad is gone.")
    const entries = ad.renders
      .filter((x) => x.status === "done" && library.get(x.assetId))
      .map((x) => {
        const a = library.get(x.assetId)
        return { name: `${ad.brief.title} · ${platformById(x.platform).label}${extname(a.file)}`, path: library.pathOf(a) }
      })
    if (!entries.length) throw new HttpError(400, "Make the ad first.")
    const copy = ad.brief.postCopy ?? {}
    entries.push({ name: "post.txt", data: [copy.primaryText, copy.headline && `Headline: ${copy.headline}`, (copy.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n") + "\n" })
    const end = ad.brief.endCard
    entries.push({ name: "script.txt", data: ad.brief.shots.map((s, i) => `${i + 1}. ${s.caption}${s.voiceover ? `\n   Voice: ${s.voiceover}` : ""}`).join("\n") + `\n\nEnd card: ${[end.headline, end.offer, end.cta].filter(Boolean).join(" · ")}\n` })
    await sendZip(res, `${ad.brief.title}.zip`, entries)
  })

  // ------------------------------------------------------------ auth
  r.on("POST", "/api/login", async ({ req, res }) => {
    const { token: given } = await readJson(req)
    if (!token || !safeEqual(String(given ?? ""), token)) throw new HttpError(401, "That access code isn't right.")
    send(res, 200, { ok: true }, { "Set-Cookie": `kino_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` })
  })

  // ------------------------------------------------------------ events
  const clients = new Set()
  const broadcast = (type, data) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) c.write(msg)
  }
  events.on("job", (j) => broadcast("job", j))
  events.on("job-removed", (j) => broadcast("job-removed", j))
  events.on("preview", (p) => broadcast("preview", p))
  events.on("asset", (a) => broadcast("asset", assetView(a)))
  events.on("asset-removed", (a) => broadcast("asset-removed", a))
  events.on("ad", (a) => broadcast("ad", a))
  events.on("ad-removed", (a) => broadcast("ad-removed", a))
  events.on("run", (r) => broadcast("run", r))
  events.on("run-removed", (r) => broadcast("run-removed", r))
  events.on("post", (p) => broadcast("post", p))
  events.on("post-removed", (p) => broadcast("post-removed", p))
  events.on("settings", (s) => broadcast("settings", s))
  events.on("apps", () => broadcast("apps", catalogue(apps)))
  engine.on("change", (st) => broadcast("engine", st))
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n")
  }, 25_000)

  const authorized = (req) => {
    if (!token) return true
    const header = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1]
    const cookie = parseCookies(req.headers.cookie).kino_token
    return [header, cookie].some((v) => v && safeEqual(v, token))
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost")
    const path = url.pathname
    try {
      // For load balancers and container health checks: it's up, and nothing else.
      if (path === "/healthz") return send(res, 200, { ok: true })
      if (path.startsWith("/api/") && path !== "/api/login" && !authorized(req)) throw new HttpError(401, "Enter the studio's access code.")
      if ((path.startsWith("/files/") || path.startsWith("/thumbs/")) && !authorized(req)) return send(res, 401, "Unauthorized")

      if (path === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" })
        res.write(`event: hello\ndata: ${JSON.stringify({ version: VERSION })}\n\n`)
        clients.add(res)
        req.on("close", () => clients.delete(res))
        return
      }
      if (path.startsWith("/files/")) return serveFile(req, res, library.filesDir, path.slice(7), { immutable: true })
      if (path.startsWith("/thumbs/")) return serveFile(req, res, library.thumbsDir, path.slice(8), { immutable: true })
      if (path.startsWith("/api/")) {
        const m = r.match(req.method, path)
        if (!m) throw new HttpError(404, "No such endpoint.")
        const out = await m.handler({ req, res, params: m.params, query: url.searchParams })
        if (!res.headersSent) send(res, 200, out ?? { ok: true })
        return
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed")
      // The SPA: real files from public/, everything else gets index.html.
      if (path !== "/" && /\.[a-z0-9]+$/i.test(path)) return serveFile(req, res, PUBLIC, path.slice(1))
      return serveFile(req, res, PUBLIC, "index.html")
    } catch (e) {
      const status = e.status ?? 500
      if (status >= 500) console.error("[kino]", req.method, path, e)
      if (!res.headersSent) send(res, status, { error: status >= 500 ? `Something went wrong: ${e.message}` : e.message })
      else res.end()
    }
  })

  server.on("close", () => {
    clearInterval(heartbeat)
    for (const c of clients) c.end()
    posts.stop()
    store.flush()
    engine.close().catch(() => {})
  })
  return { server, ctx }
}

function safeProvider(ctx) {
  try {
    return ctx.provider()
  } catch (e) {
    return { id: ctx.settings.get("provider"), label: e.message, error: e.message }
  }
}

function brandView(b) {
  return { id: b.id, name: b.name, product: b.product, colors: b.colors, offer: b.offer, cta: b.cta, claims: b.claims, banned: b.banned, audience: b.audience, voice: b.voice }
}

async function wrap400(fn) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(e.status ?? 400, e.message)
  }
}

function notFound(message) {
  throw new HttpError(404, message)
}

/** Stream a zip as a download; a failure halfway closes the connection rather than leaving half a file. */
async function sendZip(res, filename, entries) {
  res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": attachment(filename), "Cache-Control": "no-store" })
  try {
    await writeZip(res, entries)
    res.end()
  } catch (e) {
    res.destroy(e)
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
