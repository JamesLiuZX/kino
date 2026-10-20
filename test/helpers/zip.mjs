// Writes small zip archives for tests: stored or deflated entries, Unix modes
// (so executables and symlinks can be checked), names in UTF-8.

import { crc32, deflateRawSync } from "node:zlib"

/** entries: [{name, data, mode = 0o644, deflate = false, symlink = false}] */
export function makeZip(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "")
    const method = e.deflate ? 8 : 0
    const stored = method ? deflateRawSync(data) : data
    const name = Buffer.from(e.name, "utf8")
    const crc = crc32(data)
    const mode = (e.symlink ? 0o120000 : e.name.endsWith("/") ? 0o040000 : 0o100000) | (e.mode ?? (e.name.endsWith("/") ? 0o755 : 0o644))

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, stored)

    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE((3 << 8) | 20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x800, 8)
    c.writeUInt16LE(method, 10)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(stored.length, 20)
    c.writeUInt32LE(data.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE((mode << 16) >>> 0, 38)
    c.writeUInt32LE(offset, 42)
    central.push(c, name)
    offset += 30 + name.length + stored.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}
