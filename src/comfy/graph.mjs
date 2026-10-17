// Turns a stored workflow plus an app's parameter values into the exact prompt a
// provider runs. Bindings are strings so app definitions stay declarative:
//
//   "exposed:prompt"            every target the template author promoted as "prompt"
//   "node:142.megapixels"       one input on one node
//   "inject:LoadImage@105:104.last_frame"
//                               add a loader node for an uploaded file and wire it to
//                               the listed inputs (comma-separated); only when the
//                               parameter has a value, so optional inputs stay unwired
//   "seeds"                     every seed-like input (seed, noise_seed, *.seed)

const SEED_KEY = /(^|\.)(noise_)?seed$/

export function clonePrompt(prompt) {
  return structuredClone(prompt)
}

function targetsFor(workflow, binding) {
  if (binding.startsWith("exposed:")) {
    const name = binding.slice("exposed:".length)
    const e = workflow.exposed.find((x) => x.name === name)
    if (!e) throw new Error(`workflow exposes no "${name}"`)
    return e.targets
  }
  if (binding.startsWith("node:")) {
    const spec = binding.slice("node:".length)
    const dot = spec.indexOf(".")
    return [[spec.slice(0, dot), spec.slice(dot + 1)]]
  }
  throw new Error(`unknown binding ${binding}`)
}

/** Every binding in an app must resolve against its workflow; used by tests and at load. */
export function checkBindings(workflow, params) {
  const problems = []
  for (const p of params) {
    for (const b of [p.bind].flat().filter(Boolean)) {
      if (b === "seeds") continue
      try {
        if (b.startsWith("inject:")) {
          const [, wiring] = b.split("@")
          for (const t of wiring.split(",")) {
            const [id, input] = splitTarget(t)
            if (!workflow.prompt[id]) problems.push(`${p.id}: inject target node ${id} missing`)
            else if (!input) problems.push(`${p.id}: inject target ${t} has no input`)
          }
          continue
        }
        // Unconnected link inputs have no key yet, so the node existing is the check.
        for (const [id] of targetsFor(workflow, b)) {
          if (!workflow.prompt[id]) problems.push(`${p.id}: node ${id} missing`)
        }
      } catch (e) {
        problems.push(`${p.id}: ${e.message}`)
      }
    }
  }
  return problems
}

function splitTarget(t) {
  // "105:104.last_frame" -> ["105:104", "last_frame"]; node ids contain ":" but never "."
  const dot = t.indexOf(".")
  return [t.slice(0, dot), t.slice(dot + 1)]
}

export function setSeeds(prompt, seed) {
  let n = 0
  for (const node of Object.values(prompt)) {
    for (const key of Object.keys(node.inputs)) {
      if (SEED_KEY.test(key) && typeof node.inputs[key] === "number") {
        node.inputs[key] = seed
        n++
      }
    }
  }
  return n
}

/**
 * values: { paramId: value }, where file params carry the provider-side filename
 * (already uploaded). Returns a fresh prompt; the stored workflow is untouched.
 */
export function instantiate(workflow, params, values) {
  const prompt = clonePrompt(workflow.prompt)
  for (const p of params) {
    const value = values[p.id]
    for (const b of [p.bind].flat().filter(Boolean)) {
      if (b === "seeds") {
        if (typeof value === "number") setSeeds(prompt, value)
        continue
      }
      if (b.startsWith("inject:")) {
        if (value == null || value === "") continue
        const [head, wiring] = b.split("@")
        const loader = head.slice("inject:".length)
        const id = `kino_${p.id}`
        const field = loader === "LoadAudio" ? "audio" : loader === "LoadVideo" ? "file" : "image"
        prompt[id] = { class_type: loader, inputs: { [field]: value }, _meta: { title: `Kino ${p.id}` } }
        for (const t of wiring.split(",")) {
          const [nodeId, input] = splitTarget(t)
          prompt[nodeId].inputs[input] = [id, 0]
        }
        continue
      }
      if (value === undefined) continue
      const mapped = p.map ? p.map(value, values) : value
      if (mapped === undefined) continue
      for (const [id, input] of targetsFor(workflow, b)) {
        if (prompt[id]) prompt[id].inputs[input] = mapped
      }
    }
  }
  return prompt
}

/** Loader nodes whose file a provider must upload before queueing the prompt. */
export function fileInputs(prompt) {
  const out = []
  for (const [id, node] of Object.entries(prompt)) {
    const field = { LoadImage: "image", LoadAudio: "audio", LoadVideo: "file", LoadImageMask: "image" }[node.class_type]
    if (field && typeof node.inputs[field] === "string") out.push({ id, field, name: node.inputs[field] })
  }
  return out
}
