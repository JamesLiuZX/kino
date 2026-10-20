// Picks the backend that runs model apps, from the current settings. Instances
// are cached per configuration so a settings change takes effect on the next job
// without a restart.

import { ComfyProvider } from "./comfy.mjs"
import { LocalProvider } from "./local.mjs"
import { MockProvider } from "./mock.mjs"
import { RunpodProvider } from "./runpod.mjs"

let cached = { key: null, provider: null }

/** `engine` is this computer's engine (src/engine/), for the "local" provider. */
export function providerFor(settings, { engine } = {}) {
  const s = settings.all()
  const key = JSON.stringify([s.provider, s.comfyUrl, s.comfyToken, s.runpodEndpoint, s.runpodKey])
  if (cached.key !== key || (s.provider === "local" && cached.provider.engine !== engine)) cached = { key, provider: build(s, engine) }
  return cached.provider
}

function build(s, engine) {
  if (s.provider === "local") return new LocalProvider({ engine })
  if (s.provider === "comfy") return new ComfyProvider({ url: s.comfyUrl, token: s.comfyToken })
  if (s.provider === "runpod") return new RunpodProvider({ endpoint: s.runpodEndpoint, key: s.runpodKey })
  return new MockProvider()
}

export function concurrencyFor(provider, settings) {
  if (provider.id === "runpod") return settings.get("runpodConcurrency")
  if (provider.id === "comfy" || provider.id === "local") return 1 // one prompt at a time on one GPU
  return 2
}
