// The recipes that ship with Kino: recipes/*.json, read once at start.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export function builtinRecipes(dir = fileURLToPath(new URL("../recipes", import.meta.url))) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
}
