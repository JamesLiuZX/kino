// The desktop app's bridge into the page: says it's the desktop app and offers
// the two native things the studio uses (show a file in its folder, open the
// data folder). Nothing else from Node or Electron reaches the page.

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kinoDesktop", {
  platform: process.platform,
  reveal: (file) => ipcRenderer.invoke("kino:reveal", file),
  openDataFolder: () => ipcRenderer.invoke("kino:open-data"),
})
