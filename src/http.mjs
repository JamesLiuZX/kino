// Just enough HTTP for a single-page studio: a router with :params, JSON and
// raw bodies, static files with ETags, and byte ranges so <video> can seek.

import { createReadStream, statSync } from "node:fs"
import { extname, join, normalize, sep } from "node:path"

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".woff2": "font/woff2",
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export class Router {
  constructor() {
    this.routes = []
  }

  on(method, pattern, handler) {
    const keys = []
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)"))}$`)
    this.routes.push({ method, re, keys, handler })
    return this
  }

  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue
      const m = r.re.exec(path)
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }
    }
    return null
  }
}

export function send(res, status, body, headers = {}) {
  if (body === undefined || body === null) {
    res.writeHead(status, headers)
    return res.end()
  }
  const isText = typeof body === "string" || Buffer.isBuffer(body)
  const payload = isText ? body : JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": isText ? headers["Content-Type"] ?? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  })
  res.end(payload)
}

export async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, `That's too big (limit ${Math.round(limit / 1024 / 1024)} MB).`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function readJson(req, limit = 10 * 1024 * 1024) {
  const raw = await readBody(req, limit)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString("utf8"))
  } catch {
    throw new HttpError(400, "The request body isn't valid JSON.")
  }
}

/** Serve one file from `root`, refusing paths that escape it. Supports Range. */
export function serveFile(req, res, root, relPath, { immutable = false } = {}) {
  const safe = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "")
  const file = join(root, safe)
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return send(res, 403, "Forbidden")
  let st
  try {
    st = statSync(file)
    if (!st.isFile()) throw new Error()
  } catch {
    return send(res, 404, "Not found")
  }
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`
  const common = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  }
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, common)
    return res.end()
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "")
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1
    start = Math.max(0, start)
    end = Math.min(st.size - 1, end)
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}` })
      return res.end()
    }
    res.writeHead(206, { ...common, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 })
    if (req.method === "HEAD") return res.end()
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...common, "Content-Length": st.size })
  if (req.method === "HEAD") return res.end()
  createReadStream(file).pipe(res)
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((p) => p.trim().split("="))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]),
  )
}
