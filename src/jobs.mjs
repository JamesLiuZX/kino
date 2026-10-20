// The queue. A job is one run of one app with one set of values; asking for four
// variations makes four jobs with different seeds. Jobs run in lanes: local
// ffmpeg work and the GPU backend each have their own concurrency, so an instant
// camera move never waits behind a two-minute video.

import { mkdir, rm } from "node:fs/promises"
import { extname, join } from "node:path"
import { newId } from "./store.mjs"
import { FILE_TYPES, resolveValues } from "./apps.mjs"
import { instantiate } from "./comfy/graph.mjs"
import { validatePrompt } from "./comfy/validate.mjs"
import { concurrencyFor } from "./providers/index.mjs"

const KEEP_JOBS = 500
const TERMINAL = new Set(["done", "failed", "canceled"])

export class Jobs {
  constructor({ store, apps, library, settings, events, dataDir, providerFor, local = {} }) {
    Object.assign(this, { store, apps, library, settings, events, providerFor, local })
    this.tmpDir = join(dataDir, "tmp")
    this.running = new Map() // jobId -> {controller, lane}
    this.lastEmit = new Map()
  }

  /** On boot: anything that was mid-run when the server stopped can't be resumed. */
  start() {
    for (const job of this.store.list("jobs")) {
      if (job.status === "running") this.store.patch("jobs", job.id, { status: "failed", error: "Interrupted because the studio restarted. Try again.", finishedAt: Date.now() })
    }
    this.pump()
  }

  list({ limit = 200 } = {}) {
    return this.store
      .list("jobs")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  get(id) {
    return this.store.get("jobs", id)
  }

  enqueue({ appId, values = {}, count = 1, meta = {} }) {
    const app = this.apps.get(appId)
    if (!app) throw new Error(`There's no app called ${appId}.`)
    const n = Math.max(1, Math.min(4, Number(count) || 1))
    const assetExists = (id, type) => {
      const a = this.library.get(id)
      return !!a && a.kind === type
    }
    const base = resolveValues(app, values, { assetExists })
    const hasSeed = "seed" in base
    const lockedSeed = values.seed !== undefined && values.seed !== null && values.seed !== ""
    const batch = n > 1 ? newId("b") : null
    const jobs = []
    for (let i = 0; i < n; i++) {
      // Variations: consecutive seeds from a locked one, otherwise fresh random seeds.
      const seed = lockedSeed ? (base.seed + i) % 2 ** 32 : Math.floor(Math.random() * 2 ** 32)
      const v = i === 0 || !hasSeed ? base : { ...base, seed }
      const job = {
        id: newId("j"),
        appId: app.id,
        tool: app.tool,
        appLabel: app.label,
        model: app.model,
        output: app.output,
        values: v,
        status: "queued",
        progress: 0,
        message: "Queued",
        batch,
        index: i,
        estimate: app.seconds,
        createdAt: Date.now() + i, // stable order within a batch
        ...meta,
      }
      this.store.put("jobs", job)
      this.emit(job, true)
      jobs.push(job)
    }
    this.trim()
    this.pump()
    return jobs
  }

  retry(id) {
    const old = this.get(id)
    if (!old) throw new Error("That job is gone.")
    return this.enqueue({ appId: old.appId, values: old.values, count: 1, meta: pickMeta(old) })[0]
  }

  cancel(id) {
    const job = this.get(id)
    if (!job || TERMINAL.has(job.status)) return job
    if (job.status === "queued") return this.update(job, { status: "canceled", message: "Canceled", finishedAt: Date.now() }, true)
    this.running.get(id)?.controller.abort()
    this.update(job, { message: "Canceling…" }, true)
    return job
  }

  remove(id) {
    const job = this.get(id)
    if (!job) return false
    if (!TERMINAL.has(job.status)) this.cancel(id)
    this.store.remove("jobs", id)
    this.events.emit("job-removed", { id })
    return true
  }

  // ffmpeg work has its own lane, named apart from every provider (including
  // "local", this computer's engine, which must run one job at a time).
  laneFor(app) {
    return app?.local ? "ffmpeg" : this.providerFor(this.settings).id
  }

  limitFor(lane) {
    return lane === "ffmpeg" ? 2 : concurrencyFor(this.providerFor(this.settings), this.settings)
  }

  pump() {
    const queued = this.store
      .list("jobs", (j) => j.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const job of queued) {
      if (job.waitFor?.some((id) => !TERMINAL.has(this.get(id)?.status))) continue
      const app = this.apps.get(job.appId)
      if (!app) {
        this.update(job, { status: "failed", error: "That app no longer exists.", finishedAt: Date.now() }, true)
        continue
      }
      const lane = this.laneFor(app)
      const busy = [...this.running.values()].filter((r) => r.lane === lane).length
      if (busy >= this.limitFor(lane)) continue
      this.execute(job, app, lane)
    }
  }

  async execute(job, app, lane) {
    const controller = new AbortController()
    this.running.set(job.id, { controller, lane })
    const provider = app.local ? null : this.providerFor(this.settings)
    this.update(job, { status: "running", startedAt: Date.now(), progress: 0.01, message: "Starting", provider: provider?.id ?? "ffmpeg" }, true)
    const workDir = join(this.tmpDir, job.id)
    try {
      await mkdir(workDir, { recursive: true })
      const { files, inputs, bindValues, parents } = this.inputsFor(job, app)
      const onProgress = (progress, message) => this.progress(job, progress, message)
      let outputs
      if (app.local) {
        const runner = this.local[app.local]
        if (!runner) throw new Error(`No local runner for ${app.local}.`)
        outputs = await runner({ job, app, values: job.values, inputs, workDir, onProgress, signal: controller.signal })
      } else {
        const workflow = this.apps.workflowFor(app)
        const prompt = instantiate(workflow, app.params, bindValues)
        if (!app.custom) {
          const check = validatePrompt(prompt, this.apps.registry)
          if (!check.ok) throw new Error(`Kino built an invalid workflow (${check.errors[0]}). This is a bug; please report it.`)
        }
        outputs = await provider.run({ job, app, values: job.values, prompt, files, inputs, workDir, onProgress, signal: controller.signal, expectedSeconds: app.seconds })
      }
      if (controller.signal.aborted) throw Object.assign(new Error("Canceled"), { canceled: true })
      const assets = []
      for (const out of outputs) {
        assets.push(
          await this.library.add({
            ...out,
            source: job.source ?? "generated",
            jobId: job.id,
            appId: app.id,
            tool: app.tool,
            model: app.model,
            prompt: job.values.prompt ?? "",
            values: job.values,
            seed: job.values.seed,
            parents,
            demo: provider?.id === "mock",
            ...(job.adId ? { adId: job.adId } : {}),
          }),
        )
      }
      this.update(job, { status: "done", progress: 1, message: "Done", outputs: assets.map((a) => a.id), finishedAt: Date.now() }, true)
    } catch (e) {
      if (e.canceled || controller.signal.aborted) this.update(job, { status: "canceled", message: "Canceled", finishedAt: Date.now() }, true)
      else {
        console.error(`[kino] job ${job.id} (${app.id}) failed:`, e.message)
        this.update(job, { status: "failed", message: "Failed", error: e.message, finishedAt: Date.now() }, true)
      }
    } finally {
      this.running.delete(job.id)
      rm(workDir, { recursive: true, force: true }).catch(() => {})
      this.pump()
    }
  }

  /** Asset ids in the values become files for the provider and paths for local work. */
  inputsFor(job, app) {
    const files = []
    const inputs = {}
    const parents = []
    const bindValues = { ...job.values }
    for (const p of app.params) {
      if (!FILE_TYPES.has(p.type) || !job.values[p.id]) continue
      const asset = this.library.get(job.values[p.id])
      if (!asset) throw new Error(`The ${(p.label ?? p.type).toLowerCase()} for this job was deleted.`)
      const path = this.library.pathOf(asset)
      const name = `kino_${job.id}_${p.id}${extname(asset.file)}`
      files.push({ param: p.id, name, path, mime: asset.mime })
      inputs[p.id] = path
      bindValues[p.id] = name
      parents.push(asset.id)
    }
    return { files, inputs, bindValues, parents }
  }

  progress(job, progress, message) {
    if (TERMINAL.has(job.status)) return
    const p = Math.max(job.progress ?? 0, Math.min(0.99, progress))
    const changed = message !== job.message
    this.store.touch("jobs", job.id, { progress: p, message })
    this.emit(job, changed)
  }

  update(job, changes, force = false) {
    const wasTerminal = TERMINAL.has(job.status)
    this.store.patch("jobs", job.id, changes)
    this.emit(job, force)
    if (!wasTerminal && TERMINAL.has(job.status)) this.events.emit("job-finished", job)
    return job
  }

  /** At most ~5 progress events a second per job; status changes always go out. */
  emit(job, force) {
    const now = Date.now()
    if (!force && now - (this.lastEmit.get(job.id) ?? 0) < 200) return
    this.lastEmit.set(job.id, now)
    this.events.emit("job", job)
  }

  trim() {
    const done = this.store
      .list("jobs", (j) => TERMINAL.has(j.status))
      .sort((a, b) => b.createdAt - a.createdAt)
    for (const j of done.slice(KEEP_JOBS)) {
      this.store.remove("jobs", j.id)
      this.lastEmit.delete(j.id)
    }
  }
}

const pickMeta = (job) => Object.fromEntries(["source", "adId", "shotId", "stage", "label"].filter((k) => job[k] !== undefined).map((k) => [k, job[k]]))
