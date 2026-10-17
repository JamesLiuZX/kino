// Picks the backend that runs model apps, from the current settings. Instances
// are cached per configuration so a settings change takes effect on the next job
// without a restart.

import { ComfyProvider } from "./comfy.mjs"
import { MockProvider } from "./mock.mjs"
import { RunpodProvider } from "./runpod.mjs"

let cached = { key: null, provider: null }

export function providerFor(settings) {
  const s = settings.all()
  const key = JSON.stringify([s.provider, s.comfyUrl, s.comfyToken, s.runpodEndpoint, s.runpodKey])
  if (cached.key !== key) cached = { key, provider: build(s) }
  return cached.provider
}

function build(s) {
  if (s.provider === "comfy") return new ComfyProvider({ url: s.comfyUrl, token: s.comfyToken })
  if (s.provider === "runpod") return new RunpodProvider({ endpoint: s.runpodEndpoint, key: s.runpodKey })
  return new MockProvider()
}

export function concurrencyFor(provider, settings) {
  if (provider.id === "runpod") return settings.get("runpodConcurrency")
  if (provider.id === "comfy") return 1 // the server runs one prompt at a time anyway
  return 2
}
