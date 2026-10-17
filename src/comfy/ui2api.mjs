// UI-format ComfyUI workflow (what the editor saves: nodes, links, widgets_values,
// subgraphs) -> API-format prompt (what /prompt and RunPod's worker execute:
// { id: { class_type, inputs } }).
//
// Needs node definitions to map positional widget values onto input names. Pass
// either a live server's /object_info converted with registryFromObjectInfo(), or
// the bundled comfy/core_nodes.json extracted from ComfyUI's source.
//
// Besides the prompt it returns `exposed`: the inputs a template author promoted
// onto a subgraph (prompt, width, seed, ...) and the image/audio loaders. Kino
// turns those into the knobs of an app, so a template update keeps working as long
// as its exposed names stay stable.

const CONTROL_TOKENS = new Set(["fixed", "increment", "decrement", "randomize"])
const FRONTEND_ONLY = new Set(["Note", "MarkdownNote", "Reroute", "PrimitiveNode", "Label (rgthree)"])
// Output nodes that only drive an editor widget (a before/after slider) and
// save nothing: dropping them changes no result and skips a pointless decode.
const UI_ONLY_OUTPUTS = new Set(["ImageCompare"])
const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"])
const SUBGRAPH_INPUT = -10
const SUBGRAPH_OUTPUT = -20
const MODE_MUTED = 2
const MODE_BYPASS = 4

// Option trees that can't be read statically from ComfyUI's source (built by a
// helper function). Mirrors _save_video_codec_input in comfy_extras/nodes_video.py.
const CODEC = (codecs) => ({
  name: "codec",
  type: "COMBO",
  required: true,
  options: Object.fromEntries(
    codecs.map((c) => [
      c,
      c === "auto"
        ? []
        : [
            {
              name: "encoding",
              type: "COMBO",
              required: false,
              options: { auto: [], "re-encode": [{ name: "crf", type: "FLOAT", required: true }] },
            },
          ],
    ]),
  ),
})
export const REGISTRY_PATCHES = {
  SaveVideo: {
    format: {
      type: "COMBO",
      required: true,
      options: {
        auto: [CODEC(["auto", "h264", "av1"])],
        mp4: [CODEC(["auto", "h264", "av1"])],
        mkv: [CODEC(["auto", "h264", "av1"])],
        webm: [CODEC(["auto", "av1"])],
      },
    },
  },
}

/** Build the registry shape this module uses from a live server's /object_info. */
export function registryFromObjectInfo(objectInfo) {
  const nodes = {}
  for (const [id, def] of Object.entries(objectInfo)) {
    const inputs = {}
    for (const section of ["required", "optional"]) {
      const order = def.input_order?.[section] ?? Object.keys(def.input?.[section] ?? {})
      for (const name of order) {
        const spec = def.input?.[section]?.[name]
        if (!spec) continue
        const [kind, opts = {}] = spec
        const type = Array.isArray(kind) ? "COMBO" : kind === "COMFY_DYNAMICCOMBO_V3" ? "COMBO" : kind
        const entry = { type, required: section === "required" }
        if (opts.forceInput) entry.forceInput = true
        if (opts.control_after_generate || (type === "INT" && (name === "seed" || name === "noise_seed"))) entry.control = true
        if (kind === "COMFY_DYNAMICCOMBO_V3") entry.options = dynamicOptions(opts.options)
        inputs[name] = entry
      }
    }
    nodes[id] = { inputs, outputs: def.output ?? [], output: !!def.output_node }
  }
  return { nodes }
}

function dynamicOptions(options = []) {
  const out = {}
  for (const opt of options) {
    const nested = []
    for (const section of ["required", "optional"]) {
      for (const [name, spec] of Object.entries(opt.inputs?.[section] ?? {})) {
        const [kind, o = {}] = spec
        const entry = { name, type: Array.isArray(kind) ? "COMBO" : kind === "COMFY_DYNAMICCOMBO_V3" ? "COMBO" : kind, required: section === "required" }
        if (kind === "COMFY_DYNAMICCOMBO_V3") entry.options = dynamicOptions(o.options)
        nested.push(entry)
      }
    }
    out[opt.key] = nested
  }
  return out
}

function nodeDef(registry, type) {
  const def = registry.nodes[type]
  if (!def) return null
  const patch = REGISTRY_PATCHES[type]
  return patch ? { ...def, inputs: { ...def.inputs, ...patch } } : def
}

/** Widget inputs in the order the editor lays out widgets: required, then optional. */
function widgetOrder(def) {
  const entries = Object.entries(def.inputs).filter(([, s]) => WIDGET_TYPES.has(s.type) && !s.forceInput)
  return [...entries.filter(([, s]) => s.required), ...entries.filter(([, s]) => !s.required)]
}

/** Walk widget specs consuming positional values; DynamicCombo children follow their selector. */
function assignWidgets(specs, values, cursor, prefix, out) {
  for (const [name, spec] of specs) {
    if (cursor.i >= values.length) return
    const key = prefix + name
    const value = values[cursor.i++]
    out[key] = value
    if (spec.control && CONTROL_TOKENS.has(values[cursor.i])) cursor.i++
    if (spec.options) {
      const nested = spec.options[value] ?? []
      if (nested.some((n) => n.unresolved)) throw new Error(`unresolved dynamic options on ${key}`)
      assignWidgets(
        nested.map((n) => [n.name, n]),
        values,
        cursor,
        key + ".",
        out,
      )
    }
  }
}

function normaliseLinks(raw) {
  const map = new Map()
  for (const l of raw ?? []) {
    if (Array.isArray(l)) map.set(l[0], { id: l[0], origin_id: l[1], origin_slot: l[2], target_id: l[3], target_slot: l[4], type: l[5] })
    else map.set(l.id, l)
  }
  return map
}

export function uiToApi(workflow, registry, { prune = true } = {}) {
  const subgraphs = new Map((workflow.definitions?.subgraphs ?? []).map((sg) => [sg.id, sg]))
  const warnings = []
  const prompt = {}
  const exposed = []

  // A scope is one graph level: the root, or one subgraph instance (possibly nested).
  const makeScope = (graph, path, instance, parent) => ({
    graph,
    path,
    instance,
    parent,
    nodes: new Map((graph.nodes ?? []).map((n) => [n.id, n])),
    links: normaliseLinks(graph.links),
  })
  const fullId = (scope, id) => (scope.path ? `${scope.path}:${id}` : String(id))
  const isInstance = (node) => subgraphs.has(node.type)

  // Values an instance holds for its subgraph's widget inputs (FastH3 style). When
  // absent (proxyWidgets style) the inner nodes keep their own widget values.
  const instanceWidgetValue = (scope, sgInputIndex) => {
    const inst = scope.instance
    const values = inst?.widgets_values
    if (!Array.isArray(values) || values.length === 0) return undefined
    const sg = scope.graph
    let cursor = 0
    for (let i = 0; i < sg.inputs.length; i++) {
      const isWidget = WIDGET_TYPES.has(sg.inputs[i].type)
      if (!isWidget) continue
      if (i === sgInputIndex) return values[cursor]
      cursor++
      if (sg.inputs[i].type === "INT" && CONTROL_TOKENS.has(values[cursor])) cursor++
    }
    return undefined
  }

  // Resolve what feeds a link in a scope: {node, slot} | {value} | null (= keep widget value).
  const resolveLink = (scope, linkId, depth = 0) => {
    if (depth > 64) throw new Error("link resolution loop")
    const link = scope.links.get(linkId)
    if (!link) return null
    if (link.origin_id === SUBGRAPH_INPUT) {
      const sgInput = scope.graph.inputs[link.origin_slot]
      const outerInput = scope.instance.inputs?.find((i) => i.name === sgInput?.name)
      if (outerInput?.link != null) return resolveLink(scope.parent, outerInput.link, depth + 1)
      const v = instanceWidgetValue(scope, link.origin_slot)
      return v === undefined ? null : { value: v }
    }
    const origin = scope.nodes.get(link.origin_id)
    if (!origin) return null
    if (origin.mode === MODE_MUTED) return null
    if (isInstance(origin)) {
      const child = makeScope(subgraphs.get(origin.type), fullId(scope, origin.id), origin, scope)
      const inner = [...child.links.values()].find((l) => l.target_id === SUBGRAPH_OUTPUT && l.target_slot === link.origin_slot)
      return inner ? resolveLink(child, inner.id, depth + 1) : null
    }
    if (origin.type === "Reroute") {
      const inLink = origin.inputs?.[0]?.link
      return inLink == null ? null : resolveLink(scope, inLink, depth + 1)
    }
    if (origin.type === "PrimitiveNode") return { value: origin.widgets_values?.[0] }
    if (origin.mode === MODE_BYPASS) {
      const wanted = origin.outputs?.[link.origin_slot]?.type
      const pass = origin.inputs?.find((i) => i.link != null && (i.type === wanted || wanted === "*")) ?? origin.inputs?.[link.origin_slot]
      return pass?.link == null ? null : resolveLink(scope, pass.link, depth + 1)
    }
    return { node: fullId(scope, origin.id), slot: link.origin_slot }
  }

  const emit = (scope) => {
    for (const node of scope.graph.nodes ?? []) {
      if (FRONTEND_ONLY.has(node.type) || UI_ONLY_OUTPUTS.has(node.type)) continue
      if (node.mode === MODE_MUTED || node.mode === MODE_BYPASS) continue
      if (isInstance(node)) {
        const child = makeScope(subgraphs.get(node.type), fullId(scope, node.id), node, scope)
        emit(child)
        if (!scope.path) collectExposed(child)
        continue
      }
      const def = nodeDef(registry, node.type)
      const id = fullId(scope, node.id)
      const inputs = {}
      if (def) {
        const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
        try {
          assignWidgets(widgetOrder(def), values, { i: 0 }, "", inputs)
        } catch (e) {
          warnings.push(`${id} ${node.type}: ${e.message}`)
        }
      } else {
        warnings.push(`${id}: unknown node type ${node.type}`)
      }
      for (const input of node.inputs ?? []) {
        if (input.link == null) continue
        const src = resolveLink(scope, input.link)
        if (src?.node != null) inputs[input.name] = [src.node, src.slot]
        else if (src && "value" in src) inputs[input.name] = src.value
      }
      prompt[id] = { class_type: node.type, inputs, _meta: { title: node.title || node.type } }
    }
  }

  // An author-promoted subgraph input becomes a named knob pointing at the inner
  // input(s) it feeds — unless the instance wires it from outside.
  const collectExposed = (scope) => {
    const sg = scope.graph
    sg.inputs.forEach((sgInput, index) => {
      const outer = scope.instance.inputs?.find((i) => i.name === sgInput.name)
      if (outer?.link != null && WIDGET_TYPES.has(sgInput.type)) return
      const targets = []
      for (const linkId of sgInput.linkIds ?? []) {
        const l = scope.links.get(linkId)
        const target = l && scope.nodes.get(l.target_id)
        if (!target) continue
        const inp = target.inputs?.[l.target_slot]
        if (inp) targets.push([fullId(scope, target.id), inp.name])
      }
      if (targets.length) exposed.push({ name: sgInput.name, type: sgInput.type, targets, sourceIndex: index })
    })
  }

  const root = makeScope(workflow, "", null, null)
  emit(root)

  for (const [id, node] of Object.entries(prompt)) {
    if (node.class_type === "LoadImage") exposed.push({ name: `image:${id}`, type: "IMAGE_FILE", targets: [[id, "image"]] })
    if (node.class_type === "LoadAudio") exposed.push({ name: `audio:${id}`, type: "AUDIO_FILE", targets: [[id, "audio"]] })
    if (node.class_type === "LoadVideo") exposed.push({ name: `video:${id}`, type: "VIDEO_FILE", targets: [[id, "file"]] })
  }

  if (prune) pruneUnreachable(prompt, registry)
  for (const e of exposed) e.targets = e.targets.filter(([id]) => prompt[id])
  return { prompt, exposed: exposed.filter((e) => e.targets.length), warnings }
}

/** Keep only nodes an output node depends on, as ComfyUI would execute them. */
export function pruneUnreachable(prompt, registry) {
  const isOutput = (n) => {
    const def = registry.nodes[n.class_type]
    return def?.output || /^(Save|Preview)/.test(n.class_type)
  }
  const keep = new Set()
  const visit = (id) => {
    if (keep.has(id) || !prompt[id]) return
    keep.add(id)
    for (const v of Object.values(prompt[id].inputs)) if (Array.isArray(v) && v.length === 2 && typeof v[1] === "number") visit(String(v[0]))
  }
  for (const [id, n] of Object.entries(prompt)) if (isOutput(n)) visit(id)
  for (const id of Object.keys(prompt)) if (!keep.has(id)) delete prompt[id]
}
