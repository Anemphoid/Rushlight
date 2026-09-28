import { app, BrowserWindow, ipcMain } from 'electron'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

// An update that has finished downloading. Kept so a window that loads after
// the download completed still hears about it.
let pending = null
let installNow = null

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

// Auto-update for the AppImage build (the only Linux format electron-updater
// can replace in place). Everything here is best-effort: a failure to check or
// download is logged and never affects the app.
export function setupUpdater() {
  ipcMain.handle('app-version', () => app.getVersion())
  ipcMain.handle('update-pending', () => pending)
  ipcMain.handle('update-install', () => {
    if (installNow) installNow()
  })

  // Dev runs and non-AppImage installs have nothing to update in place.
  if (!app.isPackaged || !process.env.APPIMAGE) return

  ;(async () => {
    try {
      const mod = await import('electron-updater')
      const autoUpdater = mod.autoUpdater || (mod.default && mod.default.autoUpdater)
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.on('update-downloaded', (info) => {
        pending = { version: info.version }
        broadcast('update-ready', pending)
      })
      autoUpdater.on('error', (err) => {
        console.error('Updater:', err && err.message ? err.message : err)
      })
      installNow = () => autoUpdater.quitAndInstall()

      const check = () =>
        autoUpdater.checkForUpdates().catch((err) => {
          console.error('Update check failed:', err && err.message ? err.message : err)
        })
      setTimeout(check, 15000)
      setInterval(check, CHECK_EVERY_MS)
    } catch (err) {
      console.error('Updater unavailable:', err && err.message ? err.message : err)
    }
  })()
}
