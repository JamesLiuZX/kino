// Zip files for export packs: every result of a recipe run, an ad in all its
// sizes with its post text. Entries are stored, not compressed (pictures and
// videos are compressed already), with each CRC worked out before its header so
// any unzip can read the result, and file contents streamed straight to the
// response so a pack of videos never sits in memory whole.

import { createReadStream } from "node:fs"

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(buf, crc = 0) {
  let c = ~crc >>> 0
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

async function fileCrc(path) {
  let crc = 0
  let size = 0
  for await (const chunk of createReadStream(path)) {
    crc = crc32(chunk, crc)
    size += chunk.length
  }
  return { crc, size }
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Names inside a zip: no folders climbing out, nothing a file system refuses, each one once. */
export function safeNames(names) {
  const seen = new Map()
  return names.map((raw) => {
    const clean =
      String(raw)
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
        .replace(/^[.\s-]+/, "")
        .slice(0, 120) || "file"
    const n = (seen.get(clean.toLowerCase()) ?? 0) + 1
    seen.set(clean.toLowerCase(), n)
    if (n === 1) return clean
    const dot = clean.lastIndexOf(".")
    return dot > 0 ? `${clean.slice(0, dot)}-${n}${clean.slice(dot)}` : `${clean}-${n}`
  })
}

/**
 * Write a zip of `entries` ({name, path} or {name, data}) to `out`, a writable
 * stream such as an HTTP response.
 */
export async function writeZip(out, entries) {
  const write = (buf) => new Promise((resolve, reject) => out.write(buf, (e) => (e ? reject(e) : resolve())))
  const names = safeNames(entries.map((e) => e.name))
  const central = []
  let offset = 0
  for (const [i, entry] of entries.entries()) {
    const name = Buffer.from(names[i], "utf8")
    const data = entry.data === undefined ? null : Buffer.from(entry.data)
    const { crc, size } = data ? { crc: crc32(data), size: data.length } : await fileCrc(entry.path)
    if (offset + 30 + name.length + size > 0xfffffff0) throw new Error("That's more than 4 GB in one zip; download the files one by one.")
    const { time, date } = dosTime(entry.mtime ?? new Date())
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed: 2.0
    local.writeUInt16LE(0x0800, 6) // names are UTF-8
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    await write(local)
    await write(name)
    if (data) await write(data)
    else for await (const chunk of createReadStream(entry.path)) await write(chunk)
    central.push({ name, crc, size, time, date, offset })
    offset += 30 + name.length + size
  }
  let directory = 0
  for (const c of central) {
    const head = Buffer.alloc(46)
    head.writeUInt32LE(0x02014b50, 0)
    head.writeUInt16LE(0x0314, 4) // made by Unix, 2.0, so the mode below is read
    head.writeUInt16LE(20, 6)
    head.writeUInt16LE(0x0800, 8)
    head.writeUInt16LE(0, 10)
    head.writeUInt16LE(c.time, 12)
    head.writeUInt16LE(c.date, 14)
    head.writeUInt32LE(c.crc, 16)
    head.writeUInt32LE(c.size, 20)
    head.writeUInt32LE(c.size, 24)
    head.writeUInt16LE(c.name.length, 28)
    head.writeUInt32LE((0o100644 << 16) >>> 0, 38) // a regular file, rw-r--r--
    head.writeUInt32LE(c.offset, 42)
    await write(head)
    await write(c.name)
    directory += 46 + c.name.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(directory, 12)
  end.writeUInt32LE(offset, 16)
  await write(end)
}

/** Content-Disposition for a download, with an ASCII fallback and the real (maybe Chinese) name. */
export function attachment(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]+/g, "-").replace(/["\\]/g, "") || "kino.zip"
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
