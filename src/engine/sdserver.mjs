// One running stable-diffusion.cpp sd-server: started on a free port on this
// machine with one model pack's files, asked for jobs over its native async
// API (/sdcpp/v1: submit, poll with a live step count, cancel), and stopped
// when another pack is needed or the studio has been idle for a while.

import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { CanceledError, readJson, request, sleep } from "../providers/common.mjs"

const LOG_LINES = 80

export class SdServer {
  constructor({ binary, args, cwd, env = process.env, key }) {
    Object.assign(this, { binary, args, cwd, env, key })
    this.log = []
    this.child = null
    this.url = null
    this.exited = null // {code, signal} once the process is gone
  }

  get alive() {
    return !!this.child && !this.exited
  }

  /** The last lines sd-server printed, for error messages. */
  tail(n = 12) {
    return this.log.slice(-n).join("\n")
  }

  /**
   * Starts the process and waits until it answers. Loading a big model can
   * take minutes; `onWait(seconds)` is called while it does.
   */
  async start({ signal, timeoutMs = 15 * 60_000, onWait = () => {} } = {}) {
    const port = await freePort()
    this.url = `http://127.0.0.1:${port}`
    const child = spawn(this.binary, [...this.args, "--listen-ip", "127.0.0.1", "--listen-port", String(port)], {
      cwd: this.cwd,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    this.child = child
    const keep = (chunk) => {
      for (const line of String(chunk).split(/\r?\n|\r/)) if (line.trim()) this.log.push(line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").trimEnd())
      if (this.log.length > LOG_LINES) this.log.splice(0, this.log.length - LOG_LINES)
    }
    child.stdout.on("data", keep)
    child.stderr.on("data", keep)
    const gone = new Promise((resolve) => {
      child.on("error", (e) => {
        this.log.push(e.message)
        this.exited ??= { code: null, error: e }
        resolve()
      })
      child.on("exit", (code, sig) => {
        this.exited ??= { code, signal: sig }
        resolve()
      })
    })
    this.gone = gone

    const started = Date.now()
    while (true) {
      if (signal?.aborted) {
        await this.stop()
        throw new CanceledError()
      }
      if (this.exited) throw new Error(this.explainExit())
      try {
        const res = await request(`${this.url}/sdcpp/v1/capabilities`, { timeoutMs: 5_000 })
        if (res.ok) {
          this.capabilities = await readJson(res)
          return this
        }
        await res.body?.cancel()
      } catch {
        // not listening yet
      }
      if (Date.now() - started > timeoutMs) {
        await this.stop()
        throw new Error(`The engine didn't finish loading the models in ${Math.round(timeoutMs / 60_000)} minutes.\n${this.tail()}`)
      }
      onWait(Math.round((Date.now() - started) / 1000))
      await Promise.race([sleep(500), gone])
    }
  }

  explainExit() {
    const { code, signal, error } = this.exited ?? {}
    const tail = this.tail()
    if (error?.code === "ENOENT") return "The engine program is missing. Reinstall it in Settings → This computer."
    if (error?.code === "EACCES") return "The engine program isn't allowed to run. Reinstall it in Settings → This computer."
    const hint = /out of memory|failed to allocate|cudaMalloc|ErrorOutOfDeviceMemory|OOM/i.test(tail)
      ? "It ran out of memory: close other apps, or use a smaller model pack. "
      : signal === "SIGKILL"
        ? "It was stopped by the system, usually for running out of memory. "
        : ""
    return `${hint}The engine stopped (${signal ?? `exit ${code}`}).${tail ? `\n${tail}` : ""}`
  }

  async call(path, { method = "GET", body, signal, timeoutMs = 60_000 } = {}) {
    if (this.exited) throw new Error(this.explainExit())
    const res = await request(`${this.url}${path}`, {
      method,
      signal,
      timeoutMs,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await readJson(res)
    if (!res.ok) {
      const message = data?.error?.message ?? (typeof data?.error === "string" ? data.error : null) ?? data?.raw ?? `HTTP ${res.status}`
      const e = new Error(res.status === 429 ? "The engine's queue is full; try again in a moment." : `The engine refused the job: ${message}`)
      e.status = res.status
      throw e
    }
    return data
  }

  /** Submits a job (`kind` is img_gen or vid_gen); resolves to its id. */
  async submit(kind, body, signal) {
    const out = await this.call(`/sdcpp/v1/${kind}`, { method: "POST", body, signal, timeoutMs: 5 * 60_000 })
    if (!out?.id) throw new Error("The engine accepted the job but gave it no id.")
    return out.id
  }

  job(id, signal) {
    return this.call(`/sdcpp/v1/jobs/${encodeURIComponent(id)}`, { signal, timeoutMs: 5 * 60_000 })
  }

  cancel(id) {
    return this.call(`/sdcpp/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", timeoutMs: 10_000 }).catch(() => null)
  }

  /** Stops the process: politely, then not. */
  async stop() {
    const child = this.child
    if (!child || this.exited) return
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
    await this.gone
    clearTimeout(timer)
  }
}

/** A port nothing is listening on right now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}
