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
    // Account centre (migration 0005). `updateProfile` takes only
    // `{ displayName?, locale?, timezone? }` — the bridge rejects anything else, so
    // a renderer bug cannot attempt an email/role change through this path.
    me: () => ipcRenderer.invoke('auth:me'),
    updateProfile: (payload) => ipcRenderer.invoke('auth:update-profile', payload),
    activity: () => ipcRenderer.invoke('auth:activity'),
    resendVerification: () => ipcRenderer.invoke('auth:resend-verification'),
    onChanged: (cb) => subscribe('auth:changed', cb),
  },
  // Agent browser workspace (spec agent-browser-workspace §6.1). Mirrors BrowserWorkspaceBridge in
  // src/types/browserWorkspace.ts. Failures resolve as `{ ok:false, code }`. No method returns the
  // control token, cookie values or page text; the main process also checks the sender's origin.
  browser: {
    state: () => ipcRenderer.invoke('browser:state'),
    onStateChanged: (cb) => subscribe('browser:state-changed', cb),
    onActivity: (cb) => subscribe('browser:activity', cb),
    onSaveResourceRequest: (cb) => subscribe('browser:save-resource-request', cb),
    // Keyboard shortcuts pressed while focus is inside a native page view ({ action }).
    onShortcut: (cb) => subscribe('browser:shortcut', cb),
    onFocusAddress: (cb) => subscribe('browser:shortcut', (p) => { if (p && p.action === 'focus-address') cb() }),
    onToggleDock: (cb) => subscribe('browser:shortcut', (p) => { if (p && p.action === 'toggle-dock') cb() }),
    openTab: (args) => ipcRenderer.invoke('browser:open-tab', args),
    closeTab: (id) => ipcRenderer.invoke('browser:close-tab', id),
    activateTab: (id) => ipcRenderer.invoke('browser:activate-tab', id),
    reorderTabs: (ids) => ipcRenderer.invoke('browser:reorder-tabs', ids),
    navigate: (id, input) => ipcRenderer.invoke('browser:navigate', id, input),
    back: (id) => ipcRenderer.invoke('browser:back', id),
    forward: (id) => ipcRenderer.invoke('browser:forward', id),
    reload: (id) => ipcRenderer.invoke('browser:reload', id),
    stop: (id) => ipcRenderer.invoke('browser:stop', id),
    setBounds: (rect) => ipcRenderer.invoke('browser:set-bounds', rect),
    setVisible: (visible) => ipcRenderer.invoke('browser:set-visible', visible),
    captureFrozen: () => ipcRenderer.invoke('browser:capture-frozen'),
    profiles: {
      list: () => ipcRenderer.invoke('browser:profiles-list'),
      create: (args) => ipcRenderer.invoke('browser:profiles-create', args),
      rename: (id, name) => ipcRenderer.invoke('browser:profiles-rename', id, name),
      switch: (id) => ipcRenderer.invoke('browser:profiles-switch', id),
      clearData: (id) => ipcRenderer.invoke('browser:profiles-clear', id),
      remove: (id) => ipcRenderer.invoke('browser:profiles-remove', id),
    },
    loginSites: () => ipcRenderer.invoke('browser:login-sites'),
    removeSite: (host) => ipcRenderer.invoke('browser:remove-site', host),
    takeOver: () => ipcRenderer.invoke('browser:take-over'),
    returnControl: () => ipcRenderer.invoke('browser:return-control'),
    resolveApproval: (id, decision) => ipcRenderer.invoke('browser:resolve-approval', id, decision),
    shareUrl: (id) => ipcRenderer.invoke('browser:share-url', id),
    revokeConsent: (profileId) => ipcRenderer.invoke('browser:revoke-consent', profileId),
  },
})
