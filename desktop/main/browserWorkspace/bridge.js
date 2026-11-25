'use strict'

// bridge.js — `browser:*` IPC handlers (spec §6.1). Same contract as the auth bridge:
// handlers never reject (a rejection loses `code` across the IPC boundary), every input
// is structurally validated, and the caller's frame must come from the app's own
// front-end origin (R2-7). No channel returns tokens, cookie values or page text.

const MAX_ID = 96
const MAX_URL = 4096
const MAX_NAME = 100

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID
const isRect = (r) => r && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k]) && Math.abs(r[k]) <= 20000) &&
  r.width >= 0 && r.height >= 0

/** @type {Record<string, (...args: any[]) => any[]|null>} channel → argument validator (null = invalid). */
const VALIDATORS = {
  'browser:open-tab': (a = {}) => (a && typeof a === 'object' && (a.url === undefined || (typeof a.url === 'string' && a.url.length <= MAX_URL)) ? [a] : null),
  'browser:close-tab': (id) => (isId(id) ? [id] : null),
  'browser:activate-tab': (id) => (isId(id) ? [id] : null),
  'browser:reorder-tabs': (ids) => (Array.isArray(ids) && ids.length <= 16 && ids.every(isId) ? [ids] : null),
  'browser:navigate': (id, input) => (isId(id) && typeof input === 'string' && input.length <= MAX_URL ? [id, input] : null),
  'browser:back': (id) => (isId(id) ? [id] : null),
  'browser:forward': (id) => (isId(id) ? [id] : null),
  'browser:reload': (id) => (isId(id) ? [id] : null),
  'browser:stop': (id) => (isId(id) ? [id] : null),
  'browser:set-bounds': (rect) => (rect === null || isRect(rect) ? [rect] : null),
  'browser:set-visible': (v) => (typeof v === 'boolean' ? [v] : null),
  'browser:capture-frozen': () => [],
  'browser:profiles-list': () => [],
  'browser:profiles-create': (a) => (a && typeof a.name === 'string' && a.name.length <= MAX_NAME ? [a.name] : null),
  'browser:profiles-rename': (id, name) => (isId(id) && typeof name === 'string' && name.length <= MAX_NAME ? [id, name] : null),
  'browser:profiles-switch': (id) => (isId(id) ? [id] : null),
  'browser:profiles-clear': (id) => (isId(id) ? [id] : null),
  'browser:profiles-remove': (id) => (isId(id) ? [id] : null),
  'browser:login-sites': () => [],
  'browser:remove-site': (host) => (typeof host === 'string' && host.length > 0 && host.length <= 253 ? [host] : null),
  'browser:take-over': () => [],
  'browser:return-control': () => [],
  'browser:resolve-approval': (id, decision) => (isId(id) && ['approve', 'approve_scope', 'deny'].includes(decision) ? [id, decision] : null),
  'browser:share-url': (id) => (isId(id) ? [id] : null),
  'browser:revoke-consent': (id) => (isId(id) ? [id] : null),
}

/** channel → workspace method name. */
const METHODS = {
  'browser:open-tab': 'openTab', 'browser:close-tab': 'closeTab', 'browser:activate-tab': 'activateTab',
  'browser:reorder-tabs': 'reorderTabs', 'browser:navigate': 'navigate', 'browser:back': 'back',
  'browser:forward': 'forward', 'browser:reload': 'reload', 'browser:stop': 'stop', 'browser:set-bounds': 'setBounds',
  'browser:set-visible': 'setVisible', 'browser:capture-frozen': 'captureFrozen', 'browser:profiles-list': 'profilesList',
  'browser:profiles-create': 'profileCreate', 'browser:profiles-rename': 'profileRename', 'browser:profiles-switch': 'profileSwitch',
  'browser:profiles-clear': 'profileClear', 'browser:profiles-remove': 'profileRemove', 'browser:login-sites': 'loginSites',
  'browser:remove-site': 'removeSite', 'browser:take-over': 'takeOver', 'browser:return-control': 'returnControl',
  'browser:resolve-approval': 'resolveApproval', 'browser:share-url': 'shareUrl', 'browser:revoke-consent': 'revokeConsent',
}

/** @param {string} url @returns {string} origin or '' */
function originOf(url) {
  try { return new URL(url).origin } catch { return '' }
}

/**
 * @param {object} deps
 * @param {object} deps.ipcMain
 * @param {object} deps.workspace Facade methods named in METHODS plus `getState()`.
 * @param {() => string[]} deps.getFrontendOrigins
 * @param {object} [deps.logger]
 * @returns {{ dispose: () => void, channels: string[] }}
 */
function registerBrowserIpc(deps) {
  const channels = [...Object.keys(METHODS), 'browser:state']
  const allowed = (event) => {
    const frame = event && event.senderFrame
    return Boolean(frame && deps.getFrontendOrigins().includes(originOf(frame.url)))
  }

  deps.ipcMain.handle('browser:state', (event) => (allowed(event) ? deps.workspace.getState() : null))

  for (const [channel, method] of Object.entries(METHODS)) {
    deps.ipcMain.handle(channel, async (event, ...args) => {
      if (!allowed(event)) return { ok: false, code: 'forbidden_sender' }
      const parsed = VALIDATORS[channel](...args)
      if (!parsed) return { ok: false, code: 'invalid_argument' }
      try {
        const result = await deps.workspace[method](...parsed)
        return result && typeof result === 'object' && 'ok' in result ? result : { ok: true, ...(result || {}) }
      } catch (err) {
        if (deps.logger) deps.logger.warn('browser', `ipc ${channel} failed: ${(err && err.message) || err}`)
        return { ok: false, code: 'internal_error' }
      }
    })
  }

  return {
    channels,
    dispose() { for (const channel of channels) deps.ipcMain.removeHandler(channel) },
  }
}

module.exports = { registerBrowserIpc, VALIDATORS, METHODS }
