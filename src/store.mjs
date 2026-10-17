// A single-file JSON database. Kino is a studio for one person or a small team on
// one machine, so a file that can be read with `cat` beats a database server: no
// migrations, no daemon, trivially backed up. Writes are debounced and atomic
// (temp file + rename), so a crash mid-write never leaves half a file behind.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"

const COLLECTIONS = ["assets", "jobs", "apps", "boards", "ads", "brands"]

/** Time-sortable ids: newest sorts last as strings, fine for listing. */
export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`

export class Store {
  constructor(dir) {
    this.dir = dir
    this.file = join(dir, "kino.json")
    this.data = Object.fromEntries(COLLECTIONS.map((c) => [c, {}]))
    this.timer = null
    mkdirSync(dir, { recursive: true })
    if (existsSync(this.file)) {
      const loaded = JSON.parse(readFileSync(this.file, "utf8"))
      for (const c of COLLECTIONS) this.data[c] = loaded[c] ?? {}
    }
  }

  list(collection, filter) {
    const rows = Object.values(this.data[collection])
    return filter ? rows.filter(filter) : rows
  }

  get(collection, id) {
    return this.data[collection][id] ?? null
  }

  put(collection, row) {
    this.data[collection][row.id] = row
    this.schedule()
    return row
  }

  patch(collection, id, changes) {
    const row = this.get(collection, id)
    if (!row) return null
    Object.assign(row, changes)
    this.schedule()
    return row
  }

  /** Change a row in memory only: for volatile fields like job progress. */
  touch(collection, id, changes) {
    const row = this.get(collection, id)
    if (row) Object.assign(row, changes)
    return row
  }

  remove(collection, id) {
    const had = id in this.data[collection]
    delete this.data[collection][id]
    if (had) this.schedule()
    return had
  }

  schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 150)
  }

  flush() {
    clearTimeout(this.timer)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }
}
