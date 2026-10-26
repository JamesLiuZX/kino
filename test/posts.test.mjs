// Saving and posting: zip export packs (read back with Kino's own unzip), and
// posts from draft to webhook: nothing goes out before Schedule, a due post
// arrives as form fields plus files with a signature, a time missed while the
// studio was closed stays missed, and with no webhook it becomes a reminder.

import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createServer } from "node:http"
import { createHmac } from "node:crypto"
import { createWriteStream, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"
import { writeZip, safeNames } from "../src/media/zip.mjs"
import { listZip, unzip } from "../src/engine/unzip.mjs"
import { Store } from "../src/store.mjs"
import { Library } from "../src/library.mjs"
import { Settings } from "../src/settings.mjs"
import { Posts, postText } from "../src/posts.mjs"
import { proceduralImage } from "../src/media/png.mjs"

const tmp = () => mkdtempSync(join(tmpdir(), "kino-post-"))

test("zip packs: files and text, UTF-8 names, duplicates and unsafe names tidied, readable by any unzip", async () => {
  const dir = tmp()
  const photo = join(dir, "photo.png")
  const png = proceduralImage({ width: 32, height: 32, seed: 3 })
  writeFileSync(photo, png)
  const file = join(dir, "pack.zip")
  const out = createWriteStream(file)
  await writeZip(out, [
    { name: "海报 1.png", path: photo },
    { name: "post.txt", data: "Weekend sale\n\n#sale" },
    { name: "post.txt", data: "again" },
    { name: "../escape.txt", data: "no" },
  ])
  out.end()
  await once(out, "close")
  assert.deepEqual((await listZip(file)).map((e) => e.name), ["海报 1.png", "post.txt", "post-2.txt", "escape.txt"])
  const dest = join(dir, "out")
  await unzip(file, dest)
  assert.deepEqual(readFileSync(join(dest, "海报 1.png")), png)
  assert.equal(readFileSync(join(dest, "post.txt"), "utf8"), "Weekend sale\n\n#sale")
  assert.deepEqual(safeNames(["a:b?.jpg", "", "A.jpg", "a.jpg"]), ["a-b-.jpg", "file", "A.jpg", "a-2.jpg"])
})

/** A webhook that keeps what it's sent, and answers with `status`. */
async function webhook() {
  const got = []
  let status = 200
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers["content-type"] } }).formData()
    got.push({ headers: req.headers, form })
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(status === 200 ? '{"ok":true}' : '{"error":"nope"}')
  })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  return { url: `http://127.0.0.1:${server.address().port}/hook`, got, fail: (s) => (status = s), close: () => server.close() }
}

async function studio(env) {
  const dir = tmp()
  const store = new Store(dir)
  const events = new EventEmitter()
  const library = new Library({ store, dir, events })
  let clock = Date.parse("2026-11-02T01:00:00Z")
  const brand = { name: "Test", banned: { en: ["cure"], zh: ["治愈"] } }
  const posts = new Posts({ store, library, settings: new Settings(dir, env), events, brandFor: (p) => (p.from?.adId ? brand : null), now: () => clock })
  const photo = await library.add({ data: proceduralImage({ width: 64, height: 80, seed: 7 }), mime: "image/png", filename: "sale.png" })
  return { posts, events, photo, library, at: () => clock, wait: (ms) => (clock += ms) }
}

test("posts: drafts until Schedule, then the webhook gets the text, the files and a signature when it's due", async () => {
  const hook = await webhook()
  try {
    const s = await studio({ KINO_POST_WEBHOOK: hook.url, KINO_POST_SECRET: "s3cret" })
    const post = s.posts.create({ title: "Weekend sale", text: "New in this week", hashtags: "sale, #weekend #sale", platforms: ["instagram", "x", "nowhere"], media: [s.photo.id, "a_gone"] })
    assert.equal(post.status, "draft")
    assert.deepEqual(post.hashtags, ["#sale", "#weekend"])
    assert.deepEqual(post.platforms, ["instagram", "x"])
    assert.deepEqual(post.media, [s.photo.id])
    assert.equal(postText(post), "New in this week\n\n#sale #weekend")

    await s.posts.tick()
    assert.equal(hook.got.length, 0, "a draft never goes out")
    assert.throws(() => s.posts.schedule(post.id, s.at() + 5_000), /at least a minute from now/)
    s.posts.update(post.id, { text: "x".repeat(281) })
    assert.throws(() => s.posts.schedule(post.id, s.at() + 600_000), /X takes 280 characters; this is 297/)
    s.posts.update(post.id, { text: "New in this week" })
    s.posts.schedule(post.id, s.at() + 600_000)
    assert.equal(s.posts.get(post.id).status, "scheduled")

    s.wait(300_000)
    await s.posts.tick()
    assert.equal(hook.got.length, 0, "not before its time")
    s.wait(301_000)
    await s.posts.tick()
    assert.equal(hook.got.length, 1)
    const { form, headers } = hook.got[0]
    const payload = form.get("payload")
    assert.equal(headers["x-kino-signature"], `sha256=${createHmac("sha256", "s3cret").update(payload).digest("hex")}`)
    assert.equal(form.get("text"), "New in this week\r\n\r\n#sale #weekend", "form fields carry line breaks as forms do")
    assert.equal(JSON.parse(payload).text, "New in this week\n\n#sale #weekend")
    assert.equal(form.get("platforms"), "instagram,x")
    assert.equal(form.get("scheduled_for"), new Date(s.posts.get(post.id).at).toISOString())
    const file = form.get("media1")
    assert.equal(file.type, "image/png")
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), readFileSync(s.library.pathOf(s.photo)))
    const json = JSON.parse(payload)
    assert.equal(json.kino, "post/1")
    assert.equal(json.media[0].field, "media1")
    assert.equal(s.posts.get(post.id).status, "sent")
    assert.equal(s.posts.get(post.id).response.status, 200)
    assert.throws(() => s.posts.update(post.id, { text: "changed" }), /has gone out/)

    // The studio was closed at the time: it stays missed rather than going out hours late.
    const late = s.posts.create({ text: "Late", platforms: ["instagram"], media: [s.photo.id] })
    s.posts.schedule(late.id, s.at() + 120_000)
    s.wait(3 * 3600_000)
    await s.posts.tick()
    assert.equal(s.posts.get(late.id).status, "missed")
    assert.equal(hook.got.length, 1)

    // A webhook that refuses: the post says why and can be sent again.
    hook.fail(500)
    const refused = s.posts.create({ text: "Refused", platforms: ["facebook"], media: [s.photo.id] })
    await s.posts.sendNow(refused.id)
    assert.equal(s.posts.get(refused.id).status, "failed")
    assert.match(s.posts.get(refused.id).error, /answered 500/)
  } finally {
    hook.close()
  }
})

test("posts: with no webhook, a due post becomes a reminder you mark as posted", async () => {
  const s = await studio({})
  const due = []
  s.events.on("post-due", (p) => due.push(p.id))
  const post = s.posts.create({ text: "By hand", platforms: ["xiaohongshu"], media: [s.photo.id] })
  await assert.rejects(s.posts.sendNow(post.id), /Add a webhook in Settings/)
  s.posts.schedule(post.id, s.at() + 120_000)
  s.wait(121_000)
  await s.posts.tick()
  assert.equal(s.posts.get(post.id).status, "due")
  assert.deepEqual(due, [post.id])
  s.posts.markPosted(post.id)
  assert.equal(s.posts.get(post.id).status, "sent")
  assert.equal(s.posts.get(post.id).by, "hand")

  // A post made from an ad goes out only with words that pass the ad's compliance check.
  const fromAd = s.posts.create({ text: "The cure for long days", platforms: ["instagram"], media: [s.photo.id], from: { adId: "ad_1" } })
  assert.throws(() => s.posts.schedule(fromAd.id, s.at() + 120_000), /Not with these words: “cure” is on the brand's banned list/)
  s.posts.update(fromAd.id, { text: "A warm ritual for long days" })
  assert.equal(s.posts.schedule(fromAd.id, s.at() + 120_000).status, "scheduled")
})
