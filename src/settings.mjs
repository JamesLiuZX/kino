// Studio settings: which backend runs the models and the keys it needs. Stored in
// data/settings.json so the Settings page can change them without a restart;
// environment variables win, so a server can be configured without touching the
// file. Secrets are write-only from the browser's point of view: the API only
// ever returns whether they are set and their last four characters.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DEFAULTS = {
  provider: "mock", // mock | local | comfy | runpod
  engineBuild: "auto", // this computer's engine: auto | cpu | vulkan | cuda
  engineBinary: "", // your own stable-diffusion.cpp build: sd-server or its folder
  engineRelease: "", // pin an upstream release tag instead of the newest
  engineIdleMinutes: 10, // free the memory after this long without a job
  modelMirror: "", // download Hugging Face files from a mirror instead (HF_ENDPOINT)
  comfyUrl: "",
  comfyToken: "",
  runpodEndpoint: "",
  runpodKey: "",
  runpodConcurrency: 3,
  anthropicKey: "",
  anthropicModel: "claude-opus-5-5",
  captionFont: "WenQuanYi Zen Hei",
  postWebhook: "", // where due posts go: a Zapier, Make, n8n or Buffer webhook, or your own
  postSecret: "", // signs what Kino sends there (X-Kino-Signature)
}

const ENV = {
  provider: "KINO_PROVIDER",
  engineBuild: "KINO_ENGINE_BUILD",
  engineBinary: "KINO_SDCPP",
  engineRelease: "KINO_SDCPP_RELEASE",
  engineIdleMinutes: "KINO_ENGINE_IDLE_MINUTES",
  modelMirror: "HF_ENDPOINT",
  comfyUrl: "COMFY_URL",
  comfyToken: "COMFY_TOKEN",
  runpodEndpoint: "RUNPOD_ENDPOINT_ID",
  runpodKey: "RUNPOD_API_KEY",
  anthropicKey: "ANTHROPIC_API_KEY",
  anthropicModel: "KINO_CLAUDE_MODEL",
  captionFont: "KINO_CAPTION_FONT",
  postWebhook: "KINO_POST_WEBHOOK",
  postSecret: "KINO_POST_SECRET",
}

// A webhook's URL is often its only key (Zapier, Make), so it's kept like one.
const SECRETS = new Set(["comfyToken", "runpodKey", "anthropicKey", "postWebhook", "postSecret"])
const PROVIDERS = new Set(["mock", "local", "comfy", "runpod"])
const BUILDS = new Set(["auto", "cpu", "vulkan", "cuda"])
const NUMBERS = new Set(["runpodConcurrency", "engineIdleMinutes"])

export class Settings {
  /** `defaults` overrides the built-in defaults (the desktop app starts on "local"). */
  constructor(dir, env = process.env, { defaults = {} } = {}) {
    this.file = join(dir, "settings.json")
    this.env = env
    this.defaults = { ...DEFAULTS, ...defaults }
    this.saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {}
  }

  get(key) {
    const fromEnv = ENV[key] && this.env[ENV[key]]
    if (fromEnv) return NUMBERS.has(key) ? Number(fromEnv) : fromEnv
    return this.saved[key] ?? this.defaults[key]
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
      if (key === "engineBuild" && !BUILDS.has(value)) throw new Error(`unknown engine build ${value}`)
      if ((key === "comfyUrl" || key === "modelMirror") && value) value = normaliseUrl(value)
      if (key === "postWebhook" && value && !/^https?:\/\/[^\s]+$/i.test(value)) throw new Error("The webhook is a web address starting with https://.")
      if (key === "runpodConcurrency") value = Math.max(1, Math.min(20, Number(value) || DEFAULTS.runpodConcurrency))
      if (key === "engineIdleMinutes") value = Math.max(1, Math.min(240, Number(value) || DEFAULTS.engineIdleMinutes))
      if (value === "" || value === this.defaults[key]) delete this.saved[key]
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
