import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { uiohookNameForCode } from './pttKeys'
import { DEFAULT_SERVER_URL } from './defaults'
import { setupUpdater } from './updater'
import icon from '../../resources/icon.png?asset'

const NORMAL_WIDTH = 900
const NORMAL_HEIGHT = 670
const NORMAL_MIN_WIDTH = 640
const NORMAL_MIN_HEIGHT = 480

function readServerConfig() {
  const configPath = join(app.getPath('userData'), 'server-config.json')
  const defaults = { serverUrl: app.isPackaged ? DEFAULT_SERVER_URL : 'http://localhost:4000' }
  try {
    if (existsSync(configPath)) {
      return { ...defaults, ...JSON.parse(readFileSync(configPath, 'utf-8')) }
    }
  } catch {
    // fall through to writing fresh defaults below
  }
  writeFileSync(configPath, JSON.stringify(defaults, null, 2))
  return defaults
}

ipcMain.handle('get-server-config', () => readServerConfig())

// ---- Global push-to-talk ----
// Electron's own globalShortcut only fires on press — it has no "released"
// event, so it can't do hold-to-talk. uiohook-napi gives real system-wide
// keydown/keyup (proven on KDE Wayland in Alpha 1). It's loaded lazily so a
// machine where the native module can't load degrades to "PTT works while the
// window is focused" instead of failing to start at all.
let hook = null // the uIOhook instance once it has started
let hookKeys = null // uiohook's key table
let hookStatus = { ok: false, error: 'not started yet' }
let pttKeycode = null
let pttIsDown = false // OS key-repeat sends keydown over and over while held

function broadcastPtt(down) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ptt-key', { down })
  }
}

async function startPttHook() {
  try {
    const mod = await import('uiohook-napi')
    const api = mod.uIOhook ? mod : mod.default
    hook = api.uIOhook
    hookKeys = api.UiohookKey
    hook.on('keydown', (e) => {
      if (pttKeycode !== null && e.keycode === pttKeycode && !pttIsDown) {
        pttIsDown = true
        broadcastPtt(true)
      }
    })
    hook.on('keyup', (e) => {
      if (pttKeycode !== null && e.keycode === pttKeycode && pttIsDown) {
        pttIsDown = false
        broadcastPtt(false)
      }
    })
    hook.start()
    hookStatus = { ok: true }
  } catch (err) {
    hook = null
    hookStatus = { ok: false, error: err && err.message ? err.message : String(err) }
    console.error('Global push-to-talk hook unavailable:', hookStatus.error)
  }
}

ipcMain.handle('ptt-hook-status', () => hookStatus)

// Tells the hook which key to watch. ok:false only when the hook is running
// and that key has no global equivalent — with no hook, any key is accepted
// because the renderer falls back to window-focused key events.
ipcMain.handle('ptt-set-key', (event, code) => {
  if (pttIsDown) {
    pttIsDown = false
    broadcastPtt(false)
  }
  if (!hookStatus.ok) return { ok: true, hookOk: false }
  const name = uiohookNameForCode(code)
  const keycode = name && hookKeys ? hookKeys[name] : undefined
  if (keycode === undefined) return { ok: false, hookOk: true }
  pttKeycode = keycode
  return { ok: true, hookOk: true }
})

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: NORMAL_WIDTH,
    height: NORMAL_HEIGHT,
    minWidth: NORMAL_MIN_WIDTH,
    minHeight: NORMAL_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    title: 'Rushlight',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Fallback only — the normal path is the renderer measuring the login
  // screen and calling window-set-login-size, which shows the window itself
  // once it's sized correctly. This just guards against the window staying
  // hidden forever if that measurement never arrives for some reason.
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
    }, 500)
  })

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized-change', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximized-change', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.handle('window-maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.handle('window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})
ipcMain.handle('window-is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
})

// Login screen only: size the window exactly to fit its measured content,
// then lock resizing. Called by the renderer once it's measured itself.
ipcMain.handle('window-set-login-size', (event, { width, height }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  win.setResizable(true)
  win.setContentSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
  win.center()
  win.setResizable(false)
  if (!win.isVisible()) win.show()
})

// Called once the renderer navigates past the login screen: unlocks
// resizing and returns to the normal working size.
ipcMain.handle('window-restore-normal-size', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  win.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)
  win.setResizable(true)
  win.setContentSize(NORMAL_WIDTH, NORMAL_HEIGHT)
  win.center()
})

app.whenReady().then(() => {
  createWindow()
  startPttHook()
  setupUpdater()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  try {
    if (hook) hook.stop()
  } catch {
    // shutting down anyway
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
