// Kino as a desktop app. The studio's own server runs inside this process on
// 127.0.0.1, behind an access code made fresh at every launch, and a window
// shows it: the same interface and API as `node server.mjs` and the Docker
// image, so there is one studio to build and test, not two.
//
// Your files, settings, the engine and its models live in the app's data
// folder (File → Open data folder), never inside the app, so updating or
// reinstalling Kino leaves them alone. KINO_DATA and KINO_ENGINE_DIR move them.

import { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } from "electron"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "../src/server.mjs"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = "JamesLiuZX/kino"
const token = randomBytes(24).toString("hex")
let studio = null // {server, ctx, url, dataDir}
let win = null
let quitting = false

if (!app.requestSingleInstanceLock()) app.quit()
app.on("second-instance", () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// Apps opened from the Finder or Start menu don't get the shell's PATH, so a
// Homebrew or winget ffmpeg would go unseen. Add the usual places.
function widenPath() {
  const extra =
    process.platform === "darwin"
      ? ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]
      : process.platform === "win32"
        ? [join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Links"), "C:\\ffmpeg\\bin"]
        : ["/usr/local/bin", "/snap/bin"]
  const parts = (process.env.PATH ?? "").split(delimiter)
  process.env.PATH = [...parts, ...extra.filter((p) => p && existsSync(p) && !parts.includes(p))].join(delimiter)
}

async function startStudio() {
  const dataDir = process.env.KINO_DATA || join(app.getPath("userData"), "data")
  const { server, ctx } = createServer({ dataDir, env: { ...process.env, KINO_TOKEN: token }, settingsDefaults: { provider: "local" } })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const url = `http://127.0.0.1:${server.address().port}`
  // The window carries the access code as the studio's own login cookie would.
  await session.defaultSession.cookies.set({ url, name: "kino_token", value: token, httpOnly: true, sameSite: "strict" })
  console.log(`[kino] studio on ${url} · data in ${dataDir}`)
  return { server, ctx, url, dataDir }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    title: "Kino",
    backgroundColor: "#faf8f4",
    show: false,
    webPreferences: { preload: join(HERE, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  })
  win.loadURL(studio.url)
  win.once("ready-to-show", () => win.show())
  win.webContents.on("did-finish-load", () => console.log("[kino] window loaded"))
  win.webContents.on("did-fail-load", (_, code, description) => console.error(`[kino] window failed to load: ${description} (${code})`))
  win.on("closed", () => (win = null))
  const inside = (url) => url === studio.url || url.startsWith(`${studio.url}/`)
  // Links that leave the studio open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!inside(url)) shell.openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (event, url) => {
    if (inside(url)) return
    event.preventDefault()
    shell.openExternal(url)
  })
}

const go = (hash) => win?.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {})
const openFolder = (path) => shell.openPath(path)

function menu() {
  const mac = process.platform === "darwin"
  const data = () => studio?.dataDir
  const template = [
    ...(mac
      ? [
          {
            label: "Kino",
            submenu: [
              { role: "about" },
              { label: "Check for updates…", click: () => checkForUpdates({ quiet: false }) },
              { type: "separator" },
              { label: "Settings…", accelerator: "Cmd+,", click: () => go("#/settings") },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Open library folder", click: () => data() && openFolder(join(data(), "files")) },
        { label: "Open data folder", click: () => data() && openFolder(data()) },
        ...(mac ? [] : [{ type: "separator" }, { label: "Settings", accelerator: "Ctrl+,", click: () => go("#/settings") }, { type: "separator" }, { role: "quit" }]),
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Make", accelerator: "CmdOrCtrl+1", click: () => go("#/home") },
        { label: "Ads", accelerator: "CmdOrCtrl+2", click: () => go("#/ads") },
        { label: "Library", accelerator: "CmdOrCtrl+3", click: () => go("#/library") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Kino on GitHub", click: () => shell.openExternal(`https://github.com/${REPO}`) },
        { label: "Report a problem", click: () => shell.openExternal(`https://github.com/${REPO}/issues/new`) },
        ...(mac ? [] : [{ label: "Check for updates…", click: () => checkForUpdates({ quiet: false }) }]),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Updates without an updater library: ask GitHub for the newest release and
 * offer to open its page: quietly at launch, and with an answer either way
 * from the menu.
 */
async function checkForUpdates({ quiet = true } = {}) {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Kino" }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const release = await res.json()
    const latest = String(release.tag_name ?? "").replace(/^v/, "")
    if (newer(latest, app.getVersion())) {
      const { response } = await dialog.showMessageBox(win, {
        type: "info",
        buttons: ["Download", "Later"],
        defaultId: 0,
        message: `Kino ${latest} is out`,
        detail: `You have ${app.getVersion()}. Your files and models stay where they are when you update.`,
      })
      if (response === 0) shell.openExternal(release.html_url)
    } else if (!quiet) {
      dialog.showMessageBox(win, { type: "info", message: "Kino is up to date", detail: `Version ${app.getVersion()}.` })
    }
  } catch (e) {
    if (!quiet) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates", detail: e.message })
  }
}

export function newer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

// The page can ask for two things only: show a library file in the Finder or
// Explorer, and open the data folder.
ipcMain.handle("kino:reveal", (_, file) => {
  if (!studio || typeof file !== "string" || !/^[\w.-]+$/.test(file)) return false
  const path = join(studio.dataDir, "files", file)
  if (!existsSync(path)) return false
  shell.showItemInFolder(path)
  return true
})
ipcMain.handle("kino:open-data", () => studio && openFolder(studio.dataDir))

app.whenReady().then(async () => {
  widenPath()
  try {
    studio = await startStudio()
  } catch (e) {
    dialog.showErrorBox("Kino couldn't start", e.stack ?? String(e))
    app.exit(1)
    return
  }
  menu()
  createWindow()
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow())
  if (app.isPackaged) setTimeout(() => checkForUpdates({ quiet: true }), 8_000)
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// Stop the engine before leaving, or its server would outlive the app.
app.on("before-quit", (event) => {
  if (quitting || !studio) return
  event.preventDefault()
  quitting = true
  studio.server.close()
  studio.ctx.store.flush()
  Promise.race([studio.ctx.engine.close(), new Promise((r) => setTimeout(r, 6_000))]).finally(() => app.quit())
})
