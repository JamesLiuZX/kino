#!/usr/bin/env node
// Converts ComfyUI's official workflow templates into the API-format graphs Kino
// ships in workflows/, validates them against comfy/core_nodes.json, and collects
// every model file they load (name, folder, download URL) into runpod/models.json.
//
//   pip download --no-deps comfyui-workflow-templates-json==0.1.113
//   unzip comfyui_workflow_templates_json-*.whl -d /tmp/templates
//   node scripts/build-workflows.mjs /tmp/templates/comfyui_workflow_templates_json/templates
//   node scripts/build-workflows.mjs <dir> --describe video_fastvideo_fasth3_i2v
//
// The template package version must match the ComfyUI the registry came from
// (ComfyUI pins it in requirements.txt), or node definitions can drift.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { uiToApi } from "../src/comfy/ui2api.mjs"
import { validatePrompt } from "../src/comfy/validate.mjs"
import { SOURCES, TEMPLATES_VERSION } from "../apps/sources.mjs"
import { APPS } from "../apps/catalog.mjs"

const root = fileURLToPath(new URL("..", import.meta.url))
const [dir, flag, which] = process.argv.slice(2)
if (!dir) {
  console.error("usage: build-workflows.mjs <templates dir> [--describe <template>]")
  process.exit(2)
}
const registry = JSON.parse(readFileSync(join(root, "comfy/core_nodes.json"), "utf8"))

function modelsOf(workflow) {
  const nodes = [...(workflow.nodes ?? [])]
  for (const sg of workflow.definitions?.subgraphs ?? []) nodes.push(...(sg.nodes ?? []))
  const seen = new Map()
  for (const n of nodes) {
    if (n.mode === 2 || n.mode === 4) continue
    for (const m of n.properties?.models ?? []) {
      if (m?.name && m?.url) seen.set(m.name, { name: m.name, directory: m.directory, url: m.url })
    }
  }
  return [...seen.values()]
}

function describe(prompt) {
  for (const [id, n] of Object.entries(prompt)) {
    const ins = Object.entries(n.inputs)
      .map(([k, v]) => `${k}=${Array.isArray(v) ? `<${v.join(":")}>` : JSON.stringify(v).slice(0, 70)}`)
      .join(", ")
    console.log(`${id.padEnd(9)} ${n.class_type.padEnd(28)} ${ins}`)
  }
}

if (flag === "--describe") {
  const wf = JSON.parse(readFileSync(join(dir, `${which}.json`), "utf8"))
  const { prompt, exposed } = uiToApi(wf, registry)
  describe(prompt)
  console.log("\nexposed:")
  for (const e of exposed) console.log(`  ${e.name} (${e.type}) -> ${e.targets.map((t) => t.join(".")).join(", ")}`)
  process.exit(0)
}

mkdirSync(join(root, "workflows"), { recursive: true })
const allModels = {}
let failed = 0
for (const [id, source] of Object.entries(SOURCES)) {
  const wf = JSON.parse(readFileSync(join(dir, `${source.template}.json`), "utf8"))
  const { prompt, exposed, warnings } = uiToApi(wf, registry)
  const v = validatePrompt(prompt, registry)
  const models = modelsOf(wf).filter((m) => JSON.stringify(prompt).includes(m.name))
  for (const m of models) allModels[m.name] = { ...m, usedBy: [...(allModels[m.name]?.usedBy ?? []), id] }
  const status = v.ok ? "ok" : "INVALID"
  console.log(`${status.padEnd(7)} ${id.padEnd(16)} ${source.template} (${Object.keys(prompt).length} nodes, ${models.length} models)`)
  for (const msg of [...warnings, ...v.errors, ...v.warnings]) console.log(`        ${msg}`)
  if (!v.ok) {
    failed++
    continue
  }
  const out = {
    source: { template: source.template, templatesVersion: TEMPLATES_VERSION, comfyui: registry.comfyui },
    prompt,
    exposed,
    models,
  }
  writeFileSync(join(root, "workflows", `${id}.json`), JSON.stringify(out, null, 1) + "\n")
}

// Which studio apps need each file, so download-models.sh can take app names.
const appsByWorkflow = {}
for (const a of APPS) if (a.workflow) (appsByWorkflow[a.workflow] ??= []).push(a.id)
const manifest = Object.values(allModels)
  .map((m) => ({ ...m, apps: m.usedBy.flatMap((w) => appsByWorkflow[w] ?? []) }))
  .sort((a, b) => a.directory.localeCompare(b.directory) || a.name.localeCompare(b.name))
writeFileSync(join(root, "runpod/models.json"), JSON.stringify({ templatesVersion: TEMPLATES_VERSION, models: manifest }, null, 1) + "\n")
console.log(`\n${manifest.length} model files -> runpod/models.json`)
process.exit(failed ? 1 : 0)
