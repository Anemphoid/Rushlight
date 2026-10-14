import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
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

// Sign-in screens: size the window, centre it and show it. Called once by the renderer when the first
// sign-in screen is up. `resizable` keeps the window resizable (the new sign-in screens fill whatever size they
// get); without it the window is locked, as the old fixed-size login card needed.
ipcMain.handle('window-set-login-size', (event, { width, height, resizable }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  win.setResizable(true)
  win.setContentSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
  win.center()
  win.setResizable(!!resizable)
  if (!win.isVisible()) win.show()
})

// Called once the renderer navigates past the login screen: unlocks
// resizing and returns to the normal working size.
ipcMain.handle('window-restore-normal-size', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  widenedBy = 0
  win.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)
  win.setResizable(true)
  win.setContentSize(NORMAL_WIDTH, NORMAL_HEIGHT)
  win.center()
})

// The Jellybox column needs room of its own: widen the window by its width while it is showing and
// give the width back when it folds or goes away, so the chat and the tree are not squeezed. Not done
// when maximized or full screen (there is no room to grow into). The give-back waits a moment so
// moving between two rooms that both have Jellybox does not flicker the window.
let widenedBy = 0
let giveBackTimer = null
let tween = null // { timer, to } while the window is gliding to a new width
// Move the window to new bounds over `ms`, easing in and out like the panels in the page, so the window grows or
// shrinks in step with the column that needs the room. A new move takes over from wherever the last one is.
function glideTo(win, to, ms) {
  if (tween) {
    clearInterval(tween.timer)
    tween = null
  }
  const from = win.getBounds()
  if (!ms || (from.width === to.width && from.x === to.x)) {
    win.setBounds(to)
    return
  }
  const started = Date.now()
  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(timer)
      tween = null
      return
    }
    const t = Math.min(1, (Date.now() - started) / ms)
    const e = t * t * (3 - 2 * t)
    win.setBounds({
      x: Math.round(from.x + (to.x - from.x) * e),
      y: to.y,
      width: Math.round(from.width + (to.width - from.width) * e),
      height: to.height
    })
    if (t >= 1) {
      clearInterval(timer)
      tween = null
    }
  }, 16)
  tween = { timer, to }
}
ipcMain.handle('window-widen', (event, extra, animate = true, immediate = false) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  clearTimeout(giveBackTimer)
  const want = Math.max(0, Math.min(1000, Math.round(Number(extra) || 0)))
  if (want === widenedBy) return
  const apply = () => {
    if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) {
      widenedBy = want
      return
    }
    const b = tween ? tween.to : win.getBounds()
    const area = screen.getDisplayMatching(b).workArea
    const delta = want - widenedBy
    const width = Math.min(Math.max(b.width + delta, NORMAL_MIN_WIDTH), area.width)
    let x = b.x
    if (x + width > area.x + area.width) x = Math.max(area.x, area.x + area.width - width)
    glideTo(win, { x, y: b.y, width, height: b.height }, animate ? 300 : 0)
    widenedBy = want
  }
  // giving the room back waits a moment, so moving between two rooms that both have Jellybox does not flicker the window
  if (want < widenedBy && (!animate || immediate)) apply()
  else if (want < widenedBy) giveBackTimer = setTimeout(apply, 100)
  else apply()
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
