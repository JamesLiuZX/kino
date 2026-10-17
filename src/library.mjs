// Everything the studio has made or been given: files on disk under data/files,
// a row per file in the store. Rows carry how a file was made (app, values,
// seed, parents), which is what makes Remix and lineage possible.

import { copyFile, stat, unlink, writeFile } from "node:fs/promises"
import { mkdirSync, openSync, readSync, closeSync } from "node:fs"
import { extname, join } from "node:path"
import { newId } from "./store.mjs"
import { kindFor, MIME } from "./providers/common.mjs"
import { hasFfmpeg, probe, thumbnail } from "./media/ffmpeg.mjs"

const EXT_FOR_MIME = Object.fromEntries(Object.entries(MIME).map(([ext, mime]) => [mime, ext]))
EXT_FOR_MIME["image/jpeg"] = ".jpg"

export class Library {
  constructor({ store, dir, events }) {
    this.store = store
    this.events = events
    this.filesDir = join(dir, "files")
    this.thumbsDir = join(dir, "thumbs")
    mkdirSync(this.filesDir, { recursive: true })
    mkdirSync(this.thumbsDir, { recursive: true })
  }

  pathOf(asset) {
    return join(this.filesDir, asset.file)
  }

  get(id) {
    return this.store.get("assets", id)
  }

  /** Add a file from a Buffer (`data`) or a path; returns the new row. */
  async add({ data, path, mime, filename = "", source = "upload", ...meta }) {
    const ext = (EXT_FOR_MIME[mime] ?? extname(filename).toLowerCase()) || ".bin"
    const kind = kindFor(mime ?? MIME[ext] ?? "")
    if (!["image", "video", "audio"].includes(kind)) throw new Error("Kino keeps images, videos and audio. That file is none of those.")
    const id = newId("a")
    const file = `${id}${ext}`
    const dest = join(this.filesDir, file)
    if (data) await writeFile(dest, data)
    else await copyFile(path, dest)
    const { size } = await stat(dest)

    let width = 0
    let height = 0
    let duration = 0
    let hasAudio = false
    if (kind === "image") ({ width, height } = imageSize(dest))
    if ((kind !== "image" || !width) && (await hasFfmpeg())) {
      const info = await probe(dest).catch(() => null)
      if (info) ({ width, height, duration, hasAudio } = info)
    }

    let thumb = null
    if ((await hasFfmpeg()) && (kind === "video" || (kind === "image" && (size > 350_000 || width > 900)))) {
      const t = `${id}.jpg`
      const ok = await thumbnail(dest, join(this.thumbsDir, t), { isVideo: kind === "video", at: Math.min(0.5, duration / 3) }).then(
        () => true,
        () => false,
      )
      if (ok) thumb = t
    }

    const row = {
      id,
      kind,
      mime: mime ?? MIME[ext],
      file,
      thumb,
      width,
      height,
      duration: +duration.toFixed(2),
      hasAudio,
      bytes: size,
      name: filename && source === "upload" ? filename.slice(0, 120) : "",
      source,
      favorite: false,
      createdAt: Date.now(),
      ...meta,
    }
    this.store.put("assets", row)
    this.events.emit("asset", row)
    return row
  }

  list({ kind, source, favorite, q, limit = 120, before } = {}) {
    const needle = q?.trim().toLowerCase()
    return this.store
      .list("assets", (a) => {
        if (kind && a.kind !== kind) return false
        if (source && a.source !== source) return false
        if (favorite && !a.favorite) return false
        if (before && a.createdAt >= before) return false
        if (needle && !`${a.prompt ?? ""} ${a.name ?? ""} ${a.model ?? ""}`.toLowerCase().includes(needle)) return false
        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(500, limit))
  }

  patch(id, changes) {
    const allowed = {}
    if ("favorite" in changes) allowed.favorite = !!changes.favorite
    if ("name" in changes) allowed.name = String(changes.name ?? "").slice(0, 120)
    const row = this.store.patch("assets", id, allowed)
    if (row) this.events.emit("asset", row)
    return row
  }

  async remove(id) {
    const row = this.get(id)
    if (!row) return false
    this.store.remove("assets", id)
    await unlink(this.pathOf(row)).catch(() => {})
    if (row.thumb) await unlink(join(this.thumbsDir, row.thumb)).catch(() => {})
    this.events.emit("asset-removed", { id })
    return true
  }
}

/** The browser's view of a row: adds URLs. */
export function assetView(a) {
  return { ...a, url: `/files/${a.file}`, thumbUrl: a.thumb ? `/thumbs/${a.thumb}` : a.kind === "image" ? `/files/${a.file}` : null }
}

/** Width and height from PNG, JPEG, GIF or WebP headers, without decoding. */
export function imageSize(file) {
  const fd = openSync(file, "r")
  try {
    const buf = Buffer.alloc(64 * 1024)
    const n = readSync(fd, buf, 0, buf.length, 0)
    const b = buf.subarray(0, n)
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const fmt = b.toString("ascii", 12, 16)
      if (fmt === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
      if (fmt === "VP8L") {
        const bits = b.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      if (fmt === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    }
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++
          continue
        }
        const marker = b[i + 1]
        const len = b.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
        i += 2 + len
      }
    }
    return { width: 0, height: 0 }
  } finally {
    closeSync(fd)
  }
}
