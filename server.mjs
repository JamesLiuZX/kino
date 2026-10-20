#!/usr/bin/env node
// Kino: `node server.mjs`, then open http://localhost:7860.
//   PORT=7860  HOST=127.0.0.1  KINO_DATA=./data  KINO_TOKEN=<access code when exposed>

import { resolve } from "node:path"
import { createServer } from "./src/server.mjs"

const port = Number(process.env.PORT || 7860)
const host = process.env.HOST || "127.0.0.1"
const dataDir = resolve(process.env.KINO_DATA || new URL("./data", import.meta.url).pathname)

if (host !== "127.0.0.1" && host !== "localhost" && !process.env.KINO_TOKEN) {
  console.warn("[kino] Listening beyond this machine without KINO_TOKEN: anyone who can reach it can use your GPU and keys.")
}

const { server, ctx } = createServer({ dataDir })
server.listen(port, host, () => {
  const provider = (() => {
    try {
      return ctx.provider().label
    } catch (e) {
      return e.message
    }
  })()
  console.log(`Kino studio on http://${host === "0.0.0.0" ? "localhost" : host}:${port}  ·  ${provider}  ·  data in ${dataDir}`)
})

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    server.close()
    ctx.store.flush()
    // Stop this computer's engine too, or its server outlives the studio.
    await Promise.race([ctx.engine.close(), new Promise((r) => setTimeout(r, 6000))])
    process.exit(0)
  })
}
