'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function argValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

// IPC surface: read-only metadata plus the window controls the frameless
// title bar needs. Nothing else. The credential-bootstrap channel that used to
// hand the renderer the root password in plaintext is gone along with the user
// system — there are no credentials to bootstrap.
contextBridge.exposeInMainWorld('ecliptrixDesktop', {
  version: argValue('--ecliptrix-version='),
  logsPath: argValue('--ecliptrix-logs-path='),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (cb) => {
      const listener = (_e, val) => cb(!!val)
      ipcRenderer.on('window:maximize-changed', listener)
      return () => ipcRenderer.removeListener('window:maximize-changed', listener)
    },
  },
  // Close handshake (ME-08): the main process asks the renderer to flush
  // pending autosaves before the window closes.
  app: {
    onBeforeClose: (cb) => {
      const listener = (_e, token) => cb(token)
      ipcRenderer.on('app:before-close', listener)
      return () => ipcRenderer.removeListener('app:before-close', listener)
    },
    closeReady: (token, result) => ipcRenderer.send('app:close-ready', token, result),
  },
})
