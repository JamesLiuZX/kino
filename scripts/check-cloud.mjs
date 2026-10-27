#!/usr/bin/env node
// What Kino's website can run on fal.ai with a visitor's own key: which model
// endpoints exist, what each takes and returns (from fal's public OpenAPI
// specs, no key needed), and whether a browser may call fal directly (CORS).
//   node scripts/check-cloud.mjs            a report; exit 1 if an endpoint Kino uses is gone
//   node scripts/check-cloud.mjs --probe    also list candidate endpoints and their inputs

const USED = (await import("../web/cloud.mjs").catch(() => ({ ENDPOINTS: {} }))).ENDPOINTS ?? {}
const CANDIDATES = [
  "fal-ai/z-image/turbo",
  "fal-ai/qwen-image",
  "fal-ai/qwen-image-2512",
  "fal-ai/qwen-image-edit",
  "fal-ai/qwen-image-edit-plus",
  "fal-ai/qwen-image-edit-2509",
  "fal-ai/qwen-image-edit-2511",
  "fal-ai/nano-banana",
  "fal-ai/nano-banana/edit",
  "fal-ai/wan/v2.2-5b/image-to-video",
  "fal-ai/wan/v2.2-5b/text-to-video",
  "fal-ai/wan/v2.2-a14b/image-to-video",
  "fal-ai/wan/v2.2-a14b/text-to-video",
  "fal-ai/wan-25-preview/image-to-video",
  "fal-ai/ltx-2/image-to-video",
  "fal-ai/ltx-2/image-to-video/fast",
  "fal-ai/ltx-2/text-to-video/fast",
  "fal-ai/ltx-2/audio-to-video",
  "fal-ai/minimax/hailuo-02/standard/image-to-video",
  "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
  "fal-ai/infinitalk",
  "fal-ai/infinitalk/single-text",
  "fal-ai/bytedance/omnihuman",
  "fal-ai/seedvr/upscale/video",
  "fal-ai/seedvr/upscale/image",
  "fal-ai/film/video",
  "fal-ai/rife/video",
  "fal-ai/birefnet/v2",
  "fal-ai/esrgan",
]
const probe = process.argv.includes("--probe")
const ids = [...new Set([...Object.values(USED).map((e) => e.id), ...(probe ? CANDIDATES : [])])]

async function get(url, init = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
    } catch (e) {
      if (attempt === 2) return { status: 0, error: e.cause?.code ?? e.message, headers: new Headers() }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}

const describe = (p) => {
  if (!p) return "?"
  if (p.enum) return `enum(${p.enum.join("|")})`
  if (p.anyOf) return p.anyOf.map(describe).join("|")
  if (p.$ref) return p.$ref.split("/").pop()
  if (p.type === "array") return `[${describe(p.items)}]`
  return p.type ?? "?"
}

/** The endpoint's input and output, from its OpenAPI spec. */
async function schemaOf(id) {
  const res = await get(`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(id)}`)
  if (res.status !== 200) return { status: res.status }
  const spec = await res.json()
  const schemas = spec.components?.schemas ?? {}
  const pick = (suffix) => Object.entries(schemas).find(([name]) => name.endsWith(suffix) && !name.startsWith("Queue"))
  const input = pick("Input")
  const output = pick("Output")
  return { status: 200, input: input?.[1], inputName: input?.[0], output: output?.[1], schemas }
}

let missing = 0
const samples = new Set() // result files from the specs' examples, to see if a page may fetch them
for (const id of ids) {
  const s = await schemaOf(id)
  const used = Object.entries(USED).filter(([, e]) => e.id === id).map(([app]) => app)
  if (s.status !== 200) {
    console.log(`${used.length ? "GONE" : "none"}  ${id}${used.length ? `  (Kino uses it for ${used.join(", ")})` : ""}  ${s.status}`)
    if (used.length) missing++
    continue
  }
  console.log(`ok    ${id}${used.length ? `  (${used.join(", ")})` : ""}`)
  const req = new Set(s.input?.required ?? [])
  for (const [name, p] of Object.entries(s.input?.properties ?? {})) {
    const range = [p.minimum !== undefined ? `min ${p.minimum}` : "", p.maximum !== undefined ? `max ${p.maximum}` : ""].filter(Boolean).join(" ")
    console.log(`        in   ${req.has(name) ? "*" : " "} ${name}: ${describe(p)}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ""}${range ? ` (${range})` : ""}`)
    if (probe && /url|frames|duration|image_size/.test(name) && p.description) console.log(`               ${p.description.replace(/\s+/g, " ").slice(0, 220)}`)
  }
  if (probe) for (const m of JSON.stringify(s.schemas).matchAll(/https:\/\/[a-z0-9.]*(?:fal\.media|falserverless)[^"\\\s]+/g)) samples.add(m[0])
  for (const [name, p] of Object.entries(s.output?.properties ?? {})) console.log(`        out    ${name}: ${describe(p)}`)
  // What Kino sends has to be what the endpoint takes.
  for (const app of used) {
    const unknown = (USED[app].sends ?? []).filter((k) => !(k in (s.input?.properties ?? {})))
    if (unknown.length) {
      console.log(`GONE  ${app} sends ${unknown.join(", ")}, which ${id} doesn't take`)
      missing++
    }
  }
}

// Can a web page call fal directly with the visitor's key?
const origin = "https://jamesliuzx.com"
const target = "https://queue.fal.run/fal-ai/z-image/turbo"
const pre = await get(target, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } })
const cors = (r) => ["access-control-allow-origin", "access-control-allow-headers", "access-control-allow-methods"].map((h) => `${h}=${r.headers.get(h) ?? "-"}`).join(" ")
console.log(`cors  preflight ${target}: ${pre.status} ${cors(pre)}`)
const post = await get(target, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" })
console.log(`cors  POST without a key: ${post.status} ${cors(post)}`)
const status = await get(`${target}/requests/00000000-0000-0000-0000-000000000000/status`, { headers: { Origin: origin } })
console.log(`cors  status poll: ${status.status} ${cors(status)}`)
// Results come back as files on fal's CDN; the page fetches them to keep them.
for (const url of [...samples].slice(0, 4)) {
  const r = await get(url, { headers: { Origin: origin, Range: "bytes=0-15" } })
  console.log(`cors  result file ${new URL(url).host}: ${r.status} ${cors(r)}`)
}
const storage = await get("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } })
console.log(`cors  storage preflight: ${storage.status} ${cors(storage)}`)

process.exit(missing ? 1 : 0)
