// What the website keeps between visits, in this browser's IndexedDB: the
// library (with the files themselves), finished jobs, ads, recipe runs and
// imported recipes. Nothing is uploaded anywhere; clearing the site's data in
// the browser clears it. If the browser won't store anything (a private window,
// storage turned off), the page works as before and forgets on reload.

const DB = "kino-web"
const STORES = ["assets", "jobs", "ads", "runs", "recipes"]
let opening = null

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: "id" })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error("blocked"))
  })
  return opening
}

const done = (req) => new Promise((resolve, reject) => ((req.onsuccess = () => resolve(req.result)), (req.onerror = () => reject(req.error))))

async function store(name, mode) {
  return (await open()).transaction(name, mode).objectStore(name)
}

/** Every row of a store; [] if the browser keeps nothing. */
export async function all(name) {
  try {
    return await done((await store(name, "readonly")).getAll())
  } catch {
    return []
  }
}

export async function put(name, row) {
  try {
    await done((await store(name, "readwrite")).put(row))
  } catch (e) {
    console.warn(`[kino] couldn't keep ${name}:`, e?.message ?? e)
  }
}

export async function remove(name, id) {
  try {
    await done((await store(name, "readwrite")).delete(id))
  } catch {}
}

/** Ask the browser not to clear the library when space runs low. */
export function persist() {
  navigator.storage?.persist?.().catch(() => {})
}
