// Just enough unzip for the engine's release archives, so installing it needs
// no unzip program (minimal Linux images don't have one): stored and deflated
// entries, Zip64 sizes, streamed to disk, with Unix permissions kept so the
// programs stay executable, and symlinks restored.

import { createReadStream, createWriteStream } from "node:fs"
import { chmod, mkdir, open, symlink, rm } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createInflateRaw } from "node:zlib"

const EOCD = 0x06054b50
const EOCD64 = 0x06064b50
const EOCD64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

/** The archive's entries: [{name, method, csize, usize, offset, mode}]. */
export async function listZip(file) {
  const fh = await open(file, "r")
  try {
    return await readDirectory(fh)
  } finally {
    await fh.close()
  }
}

/** Extracts `file` into `dest`; returns the entry names. */
export async function unzip(file, dest) {
  const root = resolve(dest)
  const fh = await open(file, "r")
  try {
    const entries = await readDirectory(fh)
    for (const e of entries) {
      const rel = e.name.replace(/\\/g, "/")
      const target = resolve(root, rel)
      if (rel.startsWith("/") || (target !== root && !target.startsWith(root + sep))) throw new Error(`The archive has an unsafe path: ${e.name}`)
      if (rel.endsWith("/")) {
        await mkdir(target, { recursive: true })
        continue
      }
      await mkdir(dirname(target), { recursive: true })
      const head = Buffer.alloc(30)
      await fh.read(head, 0, 30, e.offset)
      if (head.readUInt32LE(0) !== LOCAL) throw new Error(`The archive is damaged near ${e.name}.`)
      const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
      const raw = () => (e.csize ? createReadStream(file, { start, end: start + e.csize - 1 }) : Readable.from([]))
      if ((e.mode & 0o170000) === 0o120000) {
        const chunks = []
        for await (const c of e.method === 8 ? raw().pipe(createInflateRaw()) : raw()) chunks.push(c)
        await rm(target, { force: true })
        await symlink(Buffer.concat(chunks).toString("utf8"), target)
        continue
      }
      if (e.method === 0) await pipeline(raw(), createWriteStream(target))
      else if (e.method === 8) await pipeline(raw(), createInflateRaw(), createWriteStream(target))
      else throw new Error(`The archive uses a compression Kino can't read (method ${e.method}) for ${e.name}.`)
      if (e.mode & 0o777) await chmod(target, e.mode & 0o777)
    }
    return entries.map((e) => e.name)
  } finally {
    await fh.close()
  }
}

async function readDirectory(fh) {
  const { size } = await fh.stat()
  const tailLength = Math.min(size, 22 + 0xffff)
  const tail = Buffer.alloc(tailLength)
  await fh.read(tail, 0, tailLength, size - tailLength)
  let at = -1
  for (let i = tailLength - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      at = i
      break
    }
  }
  if (at < 0) throw new Error("That file isn't a zip archive.")
  let count = tail.readUInt16LE(at + 10)
  let dirSize = tail.readUInt32LE(at + 12)
  let dirOffset = tail.readUInt32LE(at + 16)
  if ((dirOffset === 0xffffffff || count === 0xffff) && at >= 20 && tail.readUInt32LE(at - 20) === EOCD64_LOCATOR) {
    const z = Buffer.alloc(56)
    await fh.read(z, 0, 56, Number(tail.readBigUInt64LE(at - 20 + 8)))
    if (z.readUInt32LE(0) !== EOCD64) throw new Error("The archive's Zip64 directory is damaged.")
    count = Number(z.readBigUInt64LE(32))
    dirSize = Number(z.readBigUInt64LE(40))
    dirOffset = Number(z.readBigUInt64LE(48))
  }
  const dir = Buffer.alloc(dirSize)
  await fh.read(dir, 0, dirSize, dirOffset)
  const entries = []
  let p = 0
  for (let i = 0; i < count; i++) {
    if (dir.readUInt32LE(p) !== CENTRAL) throw new Error("The archive's directory is damaged.")
    const madeBy = dir.readUInt16LE(p + 4)
    const flags = dir.readUInt16LE(p + 8)
    const method = dir.readUInt16LE(p + 10)
    let csize = dir.readUInt32LE(p + 20)
    let usize = dir.readUInt32LE(p + 24)
    const nameLength = dir.readUInt16LE(p + 28)
    const extraLength = dir.readUInt16LE(p + 30)
    const commentLength = dir.readUInt16LE(p + 32)
    const external = dir.readUInt32LE(p + 38)
    let offset = dir.readUInt32LE(p + 42)
    const name = dir.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLength)
    // Zip64 extra field: 64-bit values for whichever fields overflowed, in order.
    for (let x = p + 46 + nameLength, end = x + extraLength; x + 4 <= end; ) {
      const id = dir.readUInt16LE(x)
      const length = dir.readUInt16LE(x + 2)
      if (id === 0x0001) {
        let q = x + 4
        const next = () => {
          const v = Number(dir.readBigUInt64LE(q))
          q += 8
          return v
        }
        if (usize === 0xffffffff) usize = next()
        if (csize === 0xffffffff) csize = next()
        if (offset === 0xffffffff) offset = next()
      }
      x += 4 + length
    }
    const mode = madeBy >> 8 === 3 ? (external >>> 16) & 0xffff : 0
    entries.push({ name, method, csize, usize, offset, mode })
    p += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

