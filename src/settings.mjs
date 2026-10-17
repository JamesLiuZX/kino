// Studio settings: which backend runs the models and the keys it needs. Stored in
// data/settings.json so the Settings page can change them without a restart;
// environment variables win, so a server can be configured without touching the
// file. Secrets are write-only from the browser's point of view: the API only
// ever returns whether they are set and their last four characters.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DEFAULTS = {
  provider: "mock", // mock | comfy | runpod
  comfyUrl: "",
  comfyToken: "",
  runpodEndpoint: "",
  runpodKey: "",
  runpodConcurrency: 3,
  anthropicKey: "",
  anthropicModel: "claude-opus-5-5",
  captionFont: "WenQuanYi Zen Hei",
}

const ENV = {
  provider: "KINO_PROVIDER",
  comfyUrl: "COMFY_URL",
  comfyToken: "COMFY_TOKEN",
  runpodEndpoint: "RUNPOD_ENDPOINT_ID",
  runpodKey: "RUNPOD_API_KEY",
  anthropicKey: "ANTHROPIC_API_KEY",
  anthropicModel: "KINO_CLAUDE_MODEL",
  captionFont: "KINO_CAPTION_FONT",
}

const SECRETS = new Set(["comfyToken", "runpodKey", "anthropicKey"])
const PROVIDERS = new Set(["mock", "comfy", "runpod"])

export class Settings {
  constructor(dir, env = process.env) {
    this.file = join(dir, "settings.json")
    this.env = env
    this.saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {}
  }

  get(key) {
    const fromEnv = ENV[key] && this.env[ENV[key]]
    if (fromEnv) return key === "runpodConcurrency" ? Number(fromEnv) : fromEnv
    return this.saved[key] ?? DEFAULTS[key]
  }

  all() {
    return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, this.get(k)]))
  }

  /** What the browser sees. */
  public() {
    const out = {}
    for (const key of Object.keys(DEFAULTS)) {
      const value = this.get(key)
      const locked = !!(ENV[key] && this.env[ENV[key]])
      if (SECRETS.has(key)) out[key] = { set: !!value, hint: value ? `…${String(value).slice(-4)}` : "", locked }
      else out[key] = { value, locked }
    }
    return out
  }

  update(changes) {
    for (const [key, raw] of Object.entries(changes ?? {})) {
      if (!(key in DEFAULTS)) continue
      if (SECRETS.has(key) && (raw === undefined || raw === null)) continue // untouched secret field
      let value = typeof raw === "string" ? raw.trim() : raw
      if (key === "provider" && !PROVIDERS.has(value)) throw new Error(`unknown provider ${value}`)
      if (key === "comfyUrl" && value) value = normaliseUrl(value)
      if (key === "runpodConcurrency") value = Math.max(1, Math.min(20, Number(value) || DEFAULTS.runpodConcurrency))
      if (value === "" || value === DEFAULTS[key]) delete this.saved[key]
      else this.saved[key] = value
    }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.saved, null, 2))
    renameSync(tmp, this.file)
    return this.public()
  }
}

function normaliseUrl(value) {
  let url = value
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`
}
