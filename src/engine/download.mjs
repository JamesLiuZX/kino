// Downloads that survive a dropped connection: bytes go to <file>.part, a retry
// resumes where it stopped with a Range request, and the file only gets its
// real name once it's complete. Model files are gigabytes; Wi-Fi drops.
// (The idea is open-generative-ai's electron/lib/localInference.js downloadFile,
// MIT; this version uses fetch and streams, and honours a cancel signal.)

import { createWriteStream } from "node:fs"
import { mkdir, rename, stat } from "node:fs/promises"
import { dirname } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { CanceledError, sleep } from "../providers/common.mjs"

const UA = "Kino (+https://github.com/JamesLiuZX/kino)"

/**
 * Download `url` to `dest`. onProgress({received, total}) is called at most
 * every `everyMs`. Gives up on 4xx answers straight away and on anything else
 * after `retries` attempts with growing pauses.
 */
export async function download(url, dest, { onProgress = () => {}, signal, retries = 6, everyMs = 250, retryDelayMs = 1000 } = {}) {
  const part = `${dest}.part`
  await mkdir(dirname(dest), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    const have = await stat(part).then((s) => s.size, () => 0)
    try {
      let res
      try {
        res = await fetch(url, { headers: { "User-Agent": UA, ...(have ? { Range: `bytes=${have}-` } : {}) }, signal, redirect: "follow" })
      } catch (e) {
        if (signal?.aborted) throw new CanceledError()
        throw new Error(`Couldn't reach ${new URL(url).host} (${e.cause?.code ?? e.message}).`)
      }
      // A finished .part that never got renamed (we stopped right at the end).
      if (res.status === 416 && have > 0) {
        await res.body?.cancel()
        await rename(part, dest)
        onProgress({ received: have, total: have })
        return { bytes: have }
      }
      if (!res.ok) {
        await res.body?.cancel()
        const e = new Error(res.status === 404 ? `${fileName(url)} isn't at ${new URL(url).host} any more (404).` : `${new URL(url).host} answered ${res.status} for ${fileName(url)}.`)
        e.permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
        throw e
      }
      const resumed = res.status === 206
      const length = Number(res.headers.get("content-length")) || 0
      const total = length ? (resumed ? have + length : length) : 0
      let received = resumed ? have : 0
      let last = 0
      const count = new Transform({
        transform(chunk, _, done) {
          received += chunk.length
          const now = Date.now()
          if (now - last >= everyMs) {
            last = now
            onProgress({ received, total })
          }
          done(null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(res.body), count, createWriteStream(part, { flags: resumed ? "a" : "w" }), { signal })
      if (total && received < total) throw new Error(`The download of ${fileName(url)} stopped early.`)
      await rename(part, dest)
      onProgress({ received, total: total || received })
      return { bytes: received }
    } catch (e) {
      if (signal?.aborted || e.name === "AbortError") throw new CanceledError()
      if (e.permanent || attempt >= retries) throw e
      await sleep(Math.min(30_000, retryDelayMs * 2 ** attempt), signal)
    }
  }
}

/** The size of a file at `url`, without downloading it (0 if the server won't say). */
export async function remoteSize(url, { signal } = {}) {
  try {
    const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow", signal: signal ?? AbortSignal.timeout(15_000) })
    return res.ok ? Number(res.headers.get("content-length")) || 0 : 0
  } catch {
    return 0
  }
}

export const fileName = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop())
