// "This computer": the engine folder (the stable-diffusion.cpp programs and the
// model packs), installing and updating them with progress, and the one
// sd-server that's running at a time. Everything lives under one folder,
// <data>/engine unless KINO_ENGINE_DIR says otherwise:
//   bin/      sd-server, sd-cli and their libraries
//   models/   model files, by name, shared between packs
//   tools/    ffmpeg and ffprobe, if this machine had none and Kino fetched them
//   tmp/      downloads in progress
//   engine.json  which build is installed, and file sizes learnt from the network

import { spawn } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync, readdirSync, readFileSync, statSync, statfsSync } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { totalmem } from "node:os"
import { delimiter, dirname, join, relative } from "node:path"
import { CanceledError } from "../providers/common.mjs"
import { hasFfmpeg, recheckFfmpeg } from "../media/ffmpeg.mjs"
import { ENGINE_REPO, FFMPEG_SOURCES, METAL_BUILD_URL, PACKS, STARTER_PACKS, binaryName, fileUrl, packById, packFiles, pickAssets } from "./catalog.mjs"
import { download, fileName, remoteSize } from "./download.mjs"
import { SdServer } from "./sdserver.mjs"
import { unzip } from "./unzip.mjs"

const GB = 1024 ** 3

export class Engine extends EventEmitter {
  /**
   * settings: the studio's Settings (engineBinary, engineBuild, engineRelease,
   * engineIdleMinutes). apiBase, metalUrl and ffmpegSources are overridable
   * for tests.
   */
  constructor({ dir, settings, platform = process.platform, arch = process.arch, apiBase = "https://api.github.com", metalUrl = METAL_BUILD_URL, ffmpegSources = FFMPEG_SOURCES }) {
    super()
    Object.assign(this, { dir, settings, platform, arch, apiBase, metalUrl, ffmpegSources })
    this.binDir = join(dir, "bin")
    this.modelsDir = join(dir, "models")
    this.toolsDir = join(dir, "tools")
    this.tmpDir = join(dir, "tmp")
    this.stateFile = join(dir, "engine.json")
    this.state = readState(this.stateFile)
    this.tasks = new Map() // "install" | pack id -> {phase, received, total, file, error, controller, done}
    this.setupTask = null // first-run setup: {packs, controller}
    this.current = null // the running SdServer
    this.idleTimer = null
    this.lastEmit = 0
    this.useTools()
  }

  /** ffmpeg that Kino fetched goes on the PATH, so every part of the studio finds it. */
  useTools() {
    if (!existsSync(join(this.toolsDir, binaryName("ffmpeg", this.platform)))) return false
    const parts = (process.env.PATH ?? "").split(delimiter)
    if (!parts.includes(this.toolsDir)) process.env.PATH = [this.toolsDir, ...parts].filter(Boolean).join(delimiter)
    recheckFfmpeg()
    return true
  }

  setting(key, fallback) {
    return this.settings?.get(key) ?? fallback
  }

  /** A task that's still going. A failed one stays visible for a while, but can be started again. */
  running(id) {
    const task = this.tasks.get(id)
    return task && !task.error ? task : null
  }

  // ------------------------------------------------------------ the programs

  /** Where sd-server / sd-cli are: your own build if Settings names one, else ours. */
  binaryPath(tool) {
    const custom = String(this.setting("engineBinary", "") || "").trim()
    if (custom) {
      const isDir = existsSync(custom) && statSync(custom).isDirectory()
      return join(isDir ? custom : dirname(custom), binaryName(tool, this.platform))
    }
    return join(this.binDir, this.state.root ?? "", binaryName(tool, this.platform))
  }

  installed() {
    return existsSync(this.binaryPath("sd-server"))
  }

  /** Environment for the programs: their own folder first for shared libraries. */
  childEnv() {
    const dir = dirname(this.binaryPath("sd-server"))
    const env = { ...process.env }
    const prepend = (key) => (env[key] = env[key] ? `${dir}${delimiter}${env[key]}` : dir)
    if (this.platform === "darwin") prepend("DYLD_LIBRARY_PATH")
    else if (this.platform === "win32") prepend("PATH")
    else prepend("LD_LIBRARY_PATH")
    return env
  }

  /**
   * Download and unpack the engine for this machine. Runs in the background;
   * progress and errors show up in status() and "change" events.
   */
  install({ build } = {}) {
    if (this.running("install")) return this.status()
    const task = { phase: "Finding the right build", received: 0, total: 0, controller: new AbortController() }
    this.tasks.set("install", task)
    this.changed(true)
    task.done = this.runInstall(task, build ?? this.setting("engineBuild", "auto")).then(
      () => this.finish("install"),
      (e) => this.finish("install", e),
    )
    return this.status()
  }

  async runInstall(task, build) {
    const { signal } = task.controller
    const zips = await this.resolveBuild(build, signal)
    const work = join(this.tmpDir, `install-${Date.now()}`)
    await mkdir(work, { recursive: true })
    try {
      for (const z of zips) {
        task.phase = zips.length > 1 ? `Downloading ${z.name}` : "Downloading the engine"
        await download(z.url, join(work, z.name), { signal, onProgress: (p) => this.progress(task, p) })
      }
      task.phase = "Unpacking"
      this.changed(true)
      await this.stopServer()
      const unpacked = join(work, "bin")
      for (const z of zips) await unzip(join(work, z.name), unpacked)
      const found = findFile(unpacked, binaryName("sd-server", this.platform))
      if (!found) throw new Error("The engine download doesn't contain sd-server. Try again, or pick another build in Settings.")
      await rm(this.binDir, { recursive: true, force: true })
      await mkdir(dirname(this.binDir), { recursive: true })
      await rename(unpacked, this.binDir)
      this.state = { ...this.state, root: relative(unpacked, dirname(found)) || "", release: zips[0].release, build: zips[0].build, assets: zips.map((z) => z.name), installedAt: Date.now() }
      await this.saveState()
      if (!(await hasFfmpeg())) await this.installFfmpeg(task, work)
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** ffmpeg and ffprobe from a static build, when this machine has neither. Not fatal. */
  async installFfmpeg(task, work) {
    const candidates = this.ffmpegSources[`${this.platform}-${this.arch}`]
    if (!candidates) return
    const { signal } = task.controller
    const problems = []
    for (const [n, urls] of candidates.entries()) {
      // Publishers' "latest" links blink out now and then: two tries each.
      for (let attempt = 0; attempt < 2; attempt++) {
        const unpacked = join(work, `ffmpeg-${n}-${attempt}`)
        try {
          for (const [i, url] of urls.entries()) {
            task.phase = "Downloading ffmpeg"
            task.received = task.total = 0
            const zip = join(work, `ffmpeg-${n}-${attempt}-${i}.zip`)
            await download(url, zip, { signal, onProgress: (p) => this.progress(task, p) })
            await unzip(zip, unpacked)
          }
          await mkdir(this.toolsDir, { recursive: true })
          for (const tool of ["ffmpeg", "ffprobe"]) {
            const found = findFile(unpacked, binaryName(tool, this.platform))
            if (found) await rename(found, join(this.toolsDir, binaryName(tool, this.platform)))
          }
        } catch (e) {
          if (signal.aborted) throw e
          problems.push(e.message)
          continue
        }
        // Keep it only if it runs here (an Intel build needs Rosetta).
        if (this.useTools() && (await hasFfmpeg())) {
          delete this.state.ffmpegError
          return this.saveState()
        }
        problems.push(`the build from ${new URL(urls[0]).host} didn't run on this computer`)
        break
      }
    }
    this.state.ffmpegError = `Couldn't fetch ffmpeg (${problems.join("; ")}). Install it yourself to turn on camera moves and the ad editor.`
    await this.saveState()
  }

  /** The zip(s) to fetch: Kino's Metal build on Apple Silicon, else upstream's release for this machine. */
  async resolveBuild(build, signal) {
    if (this.platform === "darwin" && this.arch === "arm64" && build !== "cpu" && (await remoteSize(this.metalUrl, { signal }))) {
      return [{ url: this.metalUrl, name: fileName(this.metalUrl), release: "kino-metal", build: "metal" }]
    }
    const pinned = String(this.setting("engineRelease", "") || "").trim()
    const path = pinned ? `/repos/${ENGINE_REPO}/releases/tags/${encodeURIComponent(pinned)}` : `/repos/${ENGINE_REPO}/releases?per_page=20`
    let releases
    try {
      const res = await fetch(`${this.apiBase}${path}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Kino" }, signal })
      if (!res.ok) throw new Error(res.status === 403 ? "GitHub's rate limit; try again in an hour" : `GitHub answered ${res.status}`)
      releases = await res.json()
    } catch (e) {
      if (signal?.aborted) throw new CanceledError()
      throw new Error(`Couldn't look up the engine's downloads (${e.message}).`)
    }
    // Upstream sometimes publishes a release with only some platforms built, so
    // take the newest one that has ours.
    for (const release of Array.isArray(releases) ? releases : [releases]) {
      const assets = release.assets ?? []
      const picked = pickAssets(assets.map((a) => a.name), { platform: this.platform, arch: this.arch, build })
      if (!picked) continue
      return [picked.main, picked.extra].filter(Boolean).map((name) => ({
        url: assets.find((a) => a.name === name).browser_download_url,
        name,
        release: release.tag_name,
        build: build === "auto" ? (/vulkan/.test(picked.main) ? "vulkan" : /cuda/.test(picked.main) ? "cuda" : "cpu") : build,
      }))
    }
    throw new Error(
      `stable-diffusion.cpp doesn't publish a build for this computer (${this.platform} ${this.arch}). ` +
        "Build it from source (its docs/build.md) and choose the folder with sd-server in Settings → This computer.",
    )
  }

  // ------------------------------------------------------------ model packs

  modelPath(name) {
    return join(this.modelsDir, name)
  }

  /** Download every missing file of a pack, one after another, in the background. */
  downloadPack(id) {
    const pack = packById(id)
    if (!pack) throw new Error(`There's no model pack called ${id}.`)
    if (this.running(id)) return this.status()
    const task = { phase: "Starting", received: 0, total: 0, controller: new AbortController() }
    this.tasks.set(id, task)
    this.changed(true)
    task.done = this.runDownload(pack, task).then(
      () => this.finish(id),
      (e) => this.finish(id, e),
    )
    return this.status()
  }

  async runDownload(pack, task) {
    const { signal } = task.controller
    const missing = packFiles(pack).filter((f) => !existsSync(this.modelPath(f.name)))
    // Sizes first, so progress covers the whole pack and we can check the disk.
    const sizes = await Promise.all(missing.map((f) => this.sizeOf(f, signal)))
    const needed = sizes.reduce((a, b) => a + b, 0) - missing.reduce((a, f) => a + partSize(this.modelPath(f.name)), 0)
    const free = freeBytes(this.dir)
    if (needed && free !== null && needed > free - 1 * GB) {
      throw new Error(`Not enough free disk space: the ${pack.label} pack needs ${fmtGb(needed)}, and ${fmtGb(free)} is free.`)
    }
    task.total = sizes.reduce((a, b) => a + b, 0)
    let done = 0
    for (const [i, f] of missing.entries()) {
      task.file = f.name
      task.phase = `Downloading ${f.name}`
      await download(this.urlOf(f), this.modelPath(f.name), {
        signal,
        onProgress: ({ received, total }) => {
          if (total && !sizes[i]) {
            sizes[i] = total
            task.total = sizes.reduce((a, b) => a + b, 0)
          }
          this.progress(task, { received: done + received, total: task.total })
        },
      })
      done += sizes[i] || statSync(this.modelPath(f.name)).size
    }
    await this.saveState()
  }

  urlOf(file) {
    return fileUrl(file, this.setting("modelMirror", ""))
  }

  async sizeOf(file, signal) {
    this.state.sizes ??= {}
    if (!this.state.sizes[file.name]) {
      const bytes = await remoteSize(this.urlOf(file), signal ? { signal } : {})
      if (bytes) this.state.sizes[file.name] = bytes
    }
    return this.state.sizes[file.name] ?? Math.round((file.gb ?? 0) * 1e9)
  }

  /**
   * Learn the real size of every file not known yet (HEAD requests), so the
   * Settings page can show what each pack weighs before you download it.
   * At most once an hour; never throws.
   */
  async refreshSizes() {
    if (this.sizing || Date.now() - (this.sizedAt ?? 0) < 3600_000) return
    this.sizing = true
    try {
      const unknown = PACKS.flatMap(packFiles).filter((f) => !this.state.sizes?.[f.name] && !existsSync(this.modelPath(f.name)))
      if (!unknown.length) return
      await Promise.all(unknown.map((f) => this.sizeOf(f)))
      await this.saveState()
      this.changed(true)
    } catch {
      // offline: the approximate sizes will do
    } finally {
      this.sizing = false
      this.sizedAt = Date.now()
    }
  }

  cancel(id) {
    this.tasks.get(id)?.controller.abort()
    return this.status()
  }

  /** Delete a pack's files (keeping any another pack also uses). */
  async removePack(id) {
    const pack = packById(id)
    if (!pack) throw new Error(`There's no model pack called ${id}.`)
    this.cancel(id)
    if (this.current?.key === id) await this.stopServer()
    const keep = new Set(PACKS.filter((p) => p.id !== id).flatMap((p) => packFiles(p).map((f) => f.name)))
    for (const f of packFiles(pack)) {
      if (keep.has(f.name)) continue
      await rm(this.modelPath(f.name), { force: true })
      await rm(`${this.modelPath(f.name)}.part`, { force: true })
    }
    this.changed(true)
    return this.status()
  }

  packReady(pack) {
    return packFiles(pack).every((f) => existsSync(this.modelPath(f.name)))
  }

  // ------------------------------------------------------------ first run

  /**
   * Everything a first run needs, in one go: the engine if it's missing, then
   * each pack in turn (the starter packs unless you pick). Each step is the
   * same task Settings shows, so progress, pausing and errors read the same
   * there. A step that fails or is paused ends the setup; running it again
   * picks up where it stopped.
   */
  setup({ packs = STARTER_PACKS, build } = {}) {
    if (this.setupTask) return this.status()
    if (!Array.isArray(packs) || packs.some((id) => !packById(id))) throw new Error("Name the model packs to set up by id, e.g. images-fast.")
    const task = { packs: [...new Set(packs)], controller: new AbortController() }
    this.setupTask = task
    this.runSetup(task, build)
      .catch((e) => console.error("[kino] engine setup:", e.message))
      .finally(() => {
        this.setupTask = null
        this.changed(true)
      })
    this.changed(true)
    return this.status()
  }

  async runSetup({ packs, controller: { signal } }, build) {
    const step = async (id, start) => {
      if (!this.running(id)) start()
      await this.tasks.get(id)?.done
    }
    if (!this.installed()) await step("install", () => this.install({ build }))
    for (const id of packs) {
      if (signal.aborted || !this.installed()) return
      const pack = packById(id)
      if (!this.packReady(pack)) await step(id, () => this.downloadPack(id))
      if (!this.packReady(pack)) return // paused or failed: that step says why
    }
  }

  /** Pause the setup and everything being fetched; it all resumes where it stopped. */
  cancelSetup() {
    this.setupTask?.controller.abort()
    for (const task of this.tasks.values()) task.controller.abort()
    return this.status()
  }

  // ------------------------------------------------------------ running

  /**
   * The sd-server for a pack, started (or swapped in for another pack's) if
   * needed. onWait(seconds) reports while the models load.
   */
  async server(pack, { signal, onWait } = {}) {
    clearTimeout(this.idleTimer)
    this.busy = (this.busy ?? 0) + 1
    try {
      if (this.current?.key === pack.id && this.current.alive) return this.current
      await this.stopServer()
      const files = Object.fromEntries(Object.entries(pack.files).map(([key, f]) => [key, this.modelPath(f.name)]))
      const server = new SdServer({ binary: this.binaryPath("sd-server"), args: pack.server(files), cwd: dirname(this.binaryPath("sd-server")), env: this.childEnv(), key: pack.id })
      this.current = server
      this.changed(true)
      await server.start({ signal, onWait })
      this.changed(true)
      return server
    } catch (e) {
      this.release()
      throw e
    }
  }

  /** A job is done with the server; stop it after a quiet spell to free the memory. */
  release() {
    this.busy = Math.max(0, (this.busy ?? 1) - 1)
    clearTimeout(this.idleTimer)
    if (this.busy) return
    const minutes = Number(this.setting("engineIdleMinutes", 10)) || 10
    this.idleTimer = setTimeout(() => this.stopServer(), minutes * 60_000)
    this.idleTimer.unref?.()
  }

  async stopServer() {
    clearTimeout(this.idleTimer)
    const server = this.current
    this.current = null
    if (server) {
      await server.stop()
      this.changed(true)
    }
  }

  /** One-shot upscale with sd-cli (no server, no diffusion model). */
  upscale({ input, output, model, repeats = 1, signal }) {
    const args = ["-M", "upscale", "--upscale-model", model, "-i", input, "-o", output, "--upscale-repeats", String(repeats)]
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath("sd-cli"), args, { cwd: dirname(this.binaryPath("sd-cli")), env: this.childEnv(), stdio: ["ignore", "pipe", "pipe"], signal, windowsHide: true })
      let log = ""
      const keep = (d) => (log = (log + d).slice(-4000))
      child.stdout.on("data", keep)
      child.stderr.on("data", keep)
      child.on("error", (e) => reject(signal?.aborted ? new CanceledError() : e))
      child.on("close", (code) => {
        if (signal?.aborted) return reject(new CanceledError())
        if (code === 0 && existsSync(output)) resolve(output)
        else reject(new Error(`Upscaling failed (exit ${code}).\n${log.trim().split("\n").slice(-8).join("\n")}`))
      })
    })
  }

  // ------------------------------------------------------------ status

  status() {
    const memoryGb = Math.round(totalmem() / GB)
    const task = (id) => {
      const t = this.tasks.get(id)
      return t ? { phase: t.phase, received: t.received, total: t.total, file: t.file ?? null, error: t.error ?? null } : null
    }
    return {
      installed: this.installed(),
      ffmpegError: this.state.ffmpegError ?? null,
      custom: !!String(this.setting("engineBinary", "") || "").trim(),
      release: this.state.release ?? null,
      build: this.state.build ?? null,
      install: task("install"),
      setup: this.setupTask ? { packs: this.setupTask.packs } : null,
      starter: STARTER_PACKS,
      dir: this.dir,
      platform: this.platform,
      arch: this.arch,
      memoryGb,
      freeGb: (() => {
        const free = freeBytes(this.dir)
        return free === null ? null : Math.floor(free / GB)
      })(),
      running: this.current?.alive ? this.current.key : null,
      packs: PACKS.map((p) => {
        const files = packFiles(p).map((f) => {
          const path = this.modelPath(f.name)
          const present = existsSync(path)
          const bytes = present ? statSync(path).size : this.state.sizes?.[f.name] ?? (f.gb ? Math.round(f.gb * 1e9) : null)
          return { name: f.name, present, bytes, partial: present ? 0 : partSize(path) }
        })
        return {
          id: p.id,
          label: p.label,
          model: p.model,
          blurb: p.blurb,
          apps: p.apps,
          memoryGb: p.memoryGb,
          fits: memoryGb >= p.memoryGb,
          ready: files.every((f) => f.present),
          bytes: files.every((f) => f.bytes) ? files.reduce((a, f) => a + f.bytes, 0) : null,
          files,
          download: task(p.id),
        }
      }),
    }
  }

  progress(task, { received, total }) {
    task.received = received
    if (total) task.total = total
    this.changed()
  }

  finish(id, error) {
    const task = this.tasks.get(id)
    if (error && !(error instanceof CanceledError) && !error.canceled) {
      console.error(`[kino] engine ${id}:`, error.message)
      if (task) task.error = error.message
      // Keep the failed task visible until the next attempt.
      setTimeout(() => this.tasks.get(id) === task && (this.tasks.delete(id), this.changed(true)), 60_000).unref?.()
    } else {
      this.tasks.delete(id)
    }
    this.changed(true)
  }

  /** "change" events, at most ~4 a second unless forced. */
  changed(force = false) {
    const now = Date.now()
    if (!force && now - this.lastEmit < 250) return
    this.lastEmit = now
    this.emit("change", this.status())
  }

  async saveState() {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.stateFile, JSON.stringify(this.state, null, 2))
  }

  /** On shutdown: stop the server and any downloads (they resume next time). */
  async close() {
    this.setupTask?.controller.abort()
    for (const t of this.tasks.values()) t.controller.abort()
    await this.stopServer()
  }
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return {}
  }
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const found = findFile(join(dir, entry.name), name)
    if (found) return found
  }
  return null
}

function partSize(path) {
  try {
    return statSync(`${path}.part`).size
  } catch {
    return 0
  }
}

function freeBytes(dir) {
  try {
    let probe = dir
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
    const s = statfsSync(probe)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}

const fmtGb = (bytes) => `${(bytes / GB).toFixed(1)} GB`
