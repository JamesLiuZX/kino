#!/usr/bin/env node
// Is Kino on the web live and current? Opens the site the way a visitor does,
// in Chromium and in WebKit (Safari's engine), and checks that:
//   - it's built from main's current website code (bootstrap.json names the commit),
//   - it starts without errors or missing files, with Recipes and the fal.ai key card,
//   - with a key saved, it says the AI apps run on fal.ai (no job is sent).
//   node scripts/check-website.mjs [https://jamesliuzx.com/kino/]
// Needs Playwright: the Website workflow installs it and points PLAYWRIGHT at it.

import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const { chromium, webkit } = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : "playwright")
const base = process.argv[2] ?? "https://jamesliuzx.com/kino/"
let failed = 0
const fail = (msg) => (failed++, console.log(`FAIL  ${msg}`))
const ok = (msg) => console.log(`ok    ${msg}`)

// Built from main? Only the files the website is built from count.
const INPUTS = ["public", "web", "src", "apps", "recipes", "brands", "package.json", "package-lock.json"]
const res = await fetch(new URL("engine/seed/bootstrap.json", base), { cache: "no-store" })
const boot = res.ok ? await res.json() : null
const live = boot?.build?.commit
if (!boot) fail(`${base} has no engine/seed/bootstrap.json (${res.status}): is the site there at all?`)
else if (!live) fail(`the live site is ${boot.version}, built before it recorded its commit. Redeploy it: james-portfolio → Actions → Deploy to GitHub Pages → Run workflow.`)
else {
  let changed = null
  try {
    changed = execFileSync("git", ["diff", "--name-only", live, "HEAD", "--", ...INPUTS]).toString().trim()
  } catch {
    fail(`the live site's commit ${live.slice(0, 7)} isn't in this checkout's history`)
  }
  if (changed) fail(`the live site is ${live.slice(0, 7)}; main has changed what it's built from since:\n${changed.split("\n").map((f) => `        ${f}`).join("\n")}\n      Redeploy it: james-portfolio → Actions → Deploy to GitHub Pages → Run workflow.`)
  else if (changed === "") ok(`the live site is built from ${live.slice(0, 7)}, current with main (version ${boot.version})`)
}

// What a visitor sees, in each browser engine.
for (const type of [chromium, webkit]) {
  const name = type.name()
  const errors = []
  const missing = new Set()
  let browser
  try {
    browser = await type.launch()
    const page = await browser.newPage()
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("response", (r) => r.status() >= 400 && r.url().startsWith(new URL(base).origin) && missing.add(`${r.status()} ${r.url()}`))
    const pill = async () => (await page.waitForFunction(() => document.querySelector(".status-pill")?.textContent, null, { timeout: 30_000 }), (await page.locator(".status-pill").textContent()).trim())
    await page.goto(base)
    const before = await pill()
    const nav = await page.locator("nav a").allTextContents()
    await page.goto(new URL("#/settings", base).href)
    await page.waitForSelector(".settings h2", { timeout: 15_000 })
    const headings = await page.locator(".settings h2").allTextContents()
    await page.evaluate(() => localStorage.setItem("kino:fal-key", "website-check"))
    await page.goto(base)
    await page.reload()
    const after = await pill()
    await page.evaluate(() => localStorage.removeItem("kino:fal-key"))
    const problems = [
      ...errors.map((e) => `error: ${e}`),
      ...[...missing].map((m) => `missing: ${m}`),
      nav.some((t) => t.includes("Recipes")) ? null : `no Recipes in the menu (${[...new Set(nav)].join(", ")})`,
      headings.some((t) => t.includes("fal.ai")) ? null : `Settings has no fal.ai key card (${headings.join(" | ")})`,
      after.includes("fal.ai") ? null : `with a key saved the status still says “${after}”`,
    ].filter(Boolean)
    if (problems.length) fail(`${name}:\n${problems.map((p) => `        ${p}`).join("\n")}`)
    else ok(`${name}: starts cleanly; “${before}” without a key, “${after}” with one; Recipes and the key card are there`)
  } catch (e) {
    fail(`${name}: ${e.message.split("\n")[0]}${errors.length ? `\n        ${errors.join("\n        ")}` : ""}`)
  } finally {
    await browser?.close()
  }
}

process.exit(failed ? 1 : 0)
