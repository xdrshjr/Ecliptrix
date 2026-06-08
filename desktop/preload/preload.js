'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function argValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

// IPC surface (updated for `desktop-direct-editor-titlebar`, spec §2.2/§2.3/R4):
// v1 deliberately exposed read-only metadata only. This feature opens a small,
// CONTROLLED set of IPC channels — window controls (frameless title bar) and
// `getBootstrapCredentials` (desktop silent auto-login). This is acceptable for
// a single-user local app whose renderer is our own trusted web app loaded from
// a same-origin local server, with external links routed to the system browser
// (supersedes the "zero privileged IPC" note in
// `docs/plans/desktop-electron-packaging/spec.md` §4.3). Follow-up convergence:
// move login into the main process and hand the renderer only a session token
// so the ROOT password never leaves the main process (spec §7 risk 1).
contextBridge.exposeInMainWorld('ecliptrixDesktop', {
  version: argValue('--ecliptrix-version='),
  logsPath: argValue('--ecliptrix-logs-path='),
  getBootstrapCredentials: () => ipcRenderer.invoke('auth:bootstrap-credentials'),
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
})
