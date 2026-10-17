// Structural checks on an API-format prompt against node definitions, before
// anything reaches a GPU: unknown nodes, missing required inputs, dangling or
// mistyped links, and widget values of the wrong kind. ComfyUI would reject the
// same things at /prompt; catching them here means a broken template fails a
// test instead of a paid RunPod job.

const isLink = (v) => Array.isArray(v) && v.length === 2 && (typeof v[0] === "string" || typeof v[0] === "number") && Number.isInteger(v[1])

function typesCompatible(outType, inType) {
  if (!outType || !inType || outType === "*" || inType === "*") return true
  const outs = String(outType).split(",")
  const ins = String(inType).split(",")
  if (outs.some((o) => ins.includes(o))) return true
  // A combo can be driven by a primitive that emits its value.
  if (ins.includes("COMBO") && outs.some((o) => ["STRING", "INT", "FLOAT", "COMBO"].includes(o))) return true
  return false
}

function valueOk(type, v) {
  switch (type) {
    case "INT":
      return typeof v === "number" && Number.isInteger(v)
    case "FLOAT":
      return typeof v === "number"
    case "BOOLEAN":
      return typeof v === "boolean"
    case "STRING":
      return typeof v === "string"
    case "COMBO":
      return ["string", "number", "boolean"].includes(typeof v)
    default:
      return true
  }
}

/** Expected keys for a DynamicCombo's chosen option, e.g. format.codec. */
function dynamicKeys(name, spec, inputs, out) {
  const chosen = inputs[name]
  for (const child of spec.options?.[chosen] ?? []) {
    if (child.unresolved) continue
    const key = `${name}.${child.name}`
    out.set(key, child)
    if (child.options) dynamicKeys(key, child, inputs, out)
  }
}

export function validatePrompt(prompt, registry) {
  const errors = []
  const warnings = []
  for (const [id, node] of Object.entries(prompt)) {
    const def = registry.nodes[node.class_type]
    if (!def) {
      errors.push(`${id}: unknown node type ${node.class_type}`)
      continue
    }
    const expected = new Map(Object.entries(def.inputs))
    for (const [name, spec] of Object.entries(def.inputs)) if (spec.options) dynamicKeys(name, spec, node.inputs, expected)
    const dynamicPrefixes = def.dynamic ?? []

    for (const [name, spec] of expected) {
      if (spec.required && !(name in node.inputs)) errors.push(`${id} ${node.class_type}: missing required input "${name}"`)
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      const spec = expected.get(name)
      if (!spec && !dynamicPrefixes.some((p) => name.startsWith(p))) {
        warnings.push(`${id} ${node.class_type}: input "${name}" is not in the node definition`)
        continue
      }
      if (isLink(value)) {
        const src = prompt[String(value[0])]
        if (!src) {
          errors.push(`${id} ${node.class_type}.${name}: links to missing node ${value[0]}`)
          continue
        }
        const srcDef = registry.nodes[src.class_type]
        if (srcDef) {
          const outType = srcDef.outputs[value[1]]
          if (outType === undefined) errors.push(`${id} ${node.class_type}.${name}: ${src.class_type} has no output ${value[1]}`)
          else if (spec && !typesCompatible(outType, spec.type)) {
            errors.push(`${id} ${node.class_type}.${name}: expects ${spec.type}, gets ${outType} from ${src.class_type}`)
          }
        }
      } else if (spec && !valueOk(spec.type, value)) {
        errors.push(`${id} ${node.class_type}.${name}: ${JSON.stringify(value)} is not a valid ${spec.type}`)
      }
    }
  }
  if (!Object.values(prompt).some((n) => registry.nodes[n.class_type]?.output || /^(Save|Preview)/.test(n.class_type))) {
    errors.push("prompt has no output node")
  }
  return { ok: errors.length === 0, errors, warnings }
}
