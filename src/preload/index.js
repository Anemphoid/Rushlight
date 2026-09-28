import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window-maximize-toggle'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  windowSetLoginSize: (width, height) =>
    ipcRenderer.invoke('window-set-login-size', { width, height }),
  windowRestoreNormalSize: () => ipcRenderer.invoke('window-restore-normal-size'),
  getServerConfig: () => ipcRenderer.invoke('get-server-config'),
  getVersion: () => ipcRenderer.invoke('app-version'),
  getPendingUpdate: () => ipcRenderer.invoke('update-pending'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateReady: (callback) => {
    const listener = (_event, info) => callback(info)
    ipcRenderer.on('update-ready', listener)
    return () => ipcRenderer.removeListener('update-ready', listener)
  },
  setPttKey: (code) => ipcRenderer.invoke('ptt-set-key', code),
  getPttHookStatus: () => ipcRenderer.invoke('ptt-hook-status'),
  onPttKey: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('ptt-key', listener)
    return () => ipcRenderer.removeListener('ptt-key', listener)
  },
  onWindowMaximizedChange: (callback) => {
    const listener = (_event, isMaximized) => callback(isMaximized)
    ipcRenderer.on('window-maximized-change', listener)
    return () => ipcRenderer.removeListener('window-maximized-change', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
