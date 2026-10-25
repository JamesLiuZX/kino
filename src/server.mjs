// Wires the studio together and serves it: the single-page app, the files, and
// a small JSON API with a server-sent event stream for live progress.

import { EventEmitter } from "node:events"
import { createServer as createHttpServer } from "node:http"
import { timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
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
import { PLATFORMS } from "./ads/platforms.mjs"
import { ANGLES } from "./ads/schema.mjs"
import { renderMotion } from "./media/motion.mjs"
import { hasFfmpeg } from "./media/ffmpeg.mjs"
import { HttpError, Router, parseCookies, readBody, readJson, send, serveFile } from "./http.mjs"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const PUBLIC = join(ROOT, "public")
const VERSION = "0.1.0"

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
      "ad-render": (ctx) => studio.runRender(ctx),
    },
  })
  studio = new AdStudio({ store, library, jobs, settings, events })
  jobs.start()
  // Brand photos go into the library up front, so the Ad Studio can show them.
  for (const b of studio.brands()) studio.brandAssets(b).catch((e) => console.error("[kino] brand assets:", e.message))
  return { events, store, settings, apps, library, jobs, studio, engine, provider: () => pick(settings) }
}

export function createServer({ dataDir, env = process.env, ...options } = {}) {
  const ctx = createStudio({ dataDir, env, ...options })
  const { events, store, settings, apps, library, jobs, studio, engine } = ctx
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
    // Ad parts (stills and clips made for an ad) stay out of the main library.
    return rows.filter((a) => source || a.source !== "ad-part").map(assetView)
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

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
