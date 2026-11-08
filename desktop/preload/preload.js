'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function argValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

// Subscribe helper: one listener, one unsubscribe function.
function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// IPC surface: read-only metadata, the window controls the frameless title bar
// needs, and the identity gate. The break-glass (localAdmin) credentials are
// compared in the main process only — the renderer has no channel that can read
// them, and no channel can read the tokens either: window.ecliptrixDesktop.auth
// only ever returns a sanitised AuthStatus.
// 本地管理员凭据只在主进程比对,渲染进程没有任何读取通道。
contextBridge.exposeInMainWorld('ecliptrixDesktop', {
  version: argValue('--ecliptrix-version='),
  logsPath: argValue('--ecliptrix-logs-path='),
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (cb) => subscribe('window:maximize-changed', (val) => cb(!!val)),
  },
  // Close handshake (ME-08): the main process asks the renderer to flush
  // pending autosaves before the window closes.
  app: {
    onBeforeClose: (cb) => subscribe('app:before-close', cb),
    closeReady: (token, result) => ipcRenderer.send('app:close-ready', token, result),
  },
  // Identity gate (spec desktop-account-login-gate §2.5 / §4.1). Failure results
  // arrive as `{ ok:false, code, message, details?, requestId? }` — the main
  // process never rejects an invoke, because a rejection loses `code` here.
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: (payload) => ipcRenderer.invoke('auth:login', payload),
    loginLocal: (payload) => ipcRenderer.invoke('auth:login-local', payload),
    logout: () => ipcRenderer.invoke('auth:logout'),
    register: (payload) => ipcRenderer.invoke('auth:register', payload),
    changePassword: (payload) => ipcRenderer.invoke('auth:change-password', payload),
    requestPasswordReset: (payload) => ipcRenderer.invoke('auth:reset-request', payload),
    listSessions: () => ipcRenderer.invoke('auth:list-sessions'),
    revokeSession: (id) => ipcRenderer.invoke('auth:revoke-session', id),
    openExternal: (url) => ipcRenderer.invoke('auth:open-external', url),
    onChanged: (cb) => subscribe('auth:changed', cb),
  },
})
