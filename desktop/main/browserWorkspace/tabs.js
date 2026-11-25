'use strict'

// tabs.js — tab model for the ACTIVE profile (spec §4.2.1, §4.2.3, D-BW2-6).
//
// A tab is a record first and a native view second: restored / blank tabs are
// "dormant" (no WebContentsView, no renderer process) until activated, which keeps
// eight remembered tabs cheap. `owner:'agent'` tabs belong to one run: only that run may
// drive them, and when the run ends they become the user's (results stay on screen).

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { writeJsonAtomic } = require('./profiles')

const MAX_PERSISTED = 8
const PERSIST_DELAY_MS = 1000

/**
 * @param {object} deps
 * @param {object} deps.viewHost
 * @param {object} deps.profiles
 * @param {() => object} deps.getSettings
 * @param {(url: string, actor: 'user'|'agent') => { ok: boolean, url?: string, code?: string }} deps.checkUrl
 * @param {(partition: string) => void} deps.prepareSession Install hardening + cookie persister.
 * @param {string} deps.dir userData/browser-workspace
 * @param {() => void} deps.onChange
 * @param {(tab: object, wc: object) => void} [deps.onWebContents] contextMenu / shortcuts / crash hooks.
 * @param {() => object|null} [deps.getWin]
 * @param {object} [deps.logger]
 */
function createTabs(deps) {
  const now = deps.now || Date.now
  const newId = deps.newId || (() => crypto.randomUUID())
  /** @type {Map<string, object>} */
  let tabs = new Map()
  let activeTabId = null
  let profileId = null
  let persistTimer = null
  const setTimer = deps.setTimer || setTimeout

  const tabsFile = (id) => path.join(deps.dir, `tabs-${id}.json`)
  const partition = () => deps.profiles.partitionFor(profileId)
  const changed = () => deps.onChange()

  function persistNow() {
    if (!profileId) return
    const user = [...tabs.values()].filter((t) => t.owner === 'user' && t.url).slice(0, MAX_PERSISTED)
    writeJsonAtomic(tabsFile(profileId), {
      v: 1, activeTabId: activeTabId && tabs.get(activeTabId) && tabs.get(activeTabId).owner === 'user' ? activeTabId : null,
      tabs: user.map((t) => ({ id: t.id, url: t.url, title: t.title, owner: 'user' })),
    })
  }
  function persistSoon() {
    if (persistTimer) return
    persistTimer = setTimer(() => { persistTimer = null; try { persistNow() } catch (e) { deps.logger && deps.logger.warn('browser', `tabs persist failed: ${e.message}`) } }, PERSIST_DELAY_MS)
    if (persistTimer && persistTimer.unref) persistTimer.unref()
  }

  function makeTab(fields) {
    return {
      id: newId(), owner: 'user', url: '', title: '', loading: false, canGoBack: false, canGoForward: false,
      audible: false, crashed: false, secure: 'https', wc: null, spawned: [], createdAt: now(), lastActiveAt: now(), ...fields,
    }
  }

  /** @returns {object} BrowserTabInfo for the renderer (no internals). */
  function info(tab) {
    const out = {
      id: tab.id, owner: tab.owner, url: tab.url, title: tab.title, loading: tab.loading, canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward, audible: tab.audible, crashed: tab.crashed, secure: tab.secure,
    }
    if (tab.origin) out.origin = tab.origin
    return out
  }

  function syncFromWebContents(tab) {
    const wc = tab.wc
    if (!wc || wc.isDestroyed()) return
    const nav = wc.navigationHistory
    const live = wc.getURL()
    tab.url = live === 'about:blank' ? '' : (live || tab.url)
    tab.title = wc.getTitle() || tab.title
    tab.canGoBack = nav ? nav.canGoBack() : wc.canGoBack()
    tab.canGoForward = nav ? nav.canGoForward() : wc.canGoForward()
    tab.loading = wc.isLoading()
    if (!['cert_error', 'blocked'].includes(tab.secure)) tab.secure = tab.url.startsWith('http:') ? 'http' : 'https'
    persistSoon()
    changed()
  }

  function bind(tab) {
    const wc = tab.wc
    const sync = () => syncFromWebContents(tab)
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate-in-page', 'page-title-updated']) wc.on(ev, sync)
    wc.on('did-navigate', () => { if (tab.secure !== 'blocked') tab.secure = 'https'; tab.crashed = false; sync() })
    wc.on('audio-state-changed', () => { tab.audible = wc.isCurrentlyAudible(); changed() })
    wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      if (code <= -200 && code >= -219) tab.secure = 'cert_error'
      else if (code === -20) tab.secure = 'blocked'
      sync()
    })
    wc.on('render-process-gone', () => { tab.crashed = true; tab.loading = false; changed() })
    wc.on('unresponsive', () => {
      const timer = setTimer(() => { if (tab.wc && !tab.wc.isDestroyed() && tab.unresponsive) tab.wc.forcefullyCrashRenderer() }, 30_000)
      if (timer && timer.unref) timer.unref()
      tab.unresponsive = true
    })
    wc.on('responsive', () => { tab.unresponsive = false })
    wc.setWindowOpenHandler((details) => openHandler(tab, details))
    if (deps.onWebContents) deps.onWebContents(tab, wc)
  }

  /** Popup / new-tab policy (spec §4.2.3 弹窗/新标签). */
  function openHandler(tab, { url, features = '', disposition }) {
    if (url !== 'about:blank' && !/^https?:/i.test(url)) return { action: 'deny' }
    const popup = disposition === 'new-window' && /width|height|popup/i.test(features)
    if (popup) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480, height: 680, parent: deps.getWin ? deps.getWin() : undefined, autoHideMenuBar: true,
          webPreferences: { partition: partition(), sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      }
    }
    const verdict = deps.checkUrl(url, tab.owner === 'agent' ? 'agent' : 'user')
    if (verdict.ok) {
      const result = open({ url: verdict.url, owner: tab.owner, runId: tab.runId, activate: tab.owner === 'user' })
      if (result.ok) tab.spawned.push(result.tab.id)
    }
    return { action: 'deny' }
  }

  function ensureView(tab) {
    if (tab.wc && !tab.wc.isDestroyed()) return tab.wc
    deps.prepareSession(partition())
    const { wc } = deps.viewHost.create(tab.id, { partition: partition(), owner: tab.owner })
    tab.wc = wc
    bind(tab)
    // A WebContents that never navigated has no CDP target: `Page.enable` would hang
    // (measured in Electron 33), so blank tabs start on about:blank.
    wc.loadURL(tab.url || 'about:blank').catch(() => {})
    return wc
  }

  function count(owner) {
    return [...tabs.values()].filter((t) => !owner || t.owner === owner).length
  }

  /**
   * Open a tab. `blank` (no url) creates a dormant start-page tab.
   * @param {{ url?: string, owner?: 'user'|'agent', runId?: string, activate?: boolean }} input
   * @returns {{ ok: true, tab: object } | { ok: false, code: string }}
   */
  function open({ url = '', owner = 'user', runId, activate = true }) {
    const settings = deps.getSettings()
    if (count() >= settings.max_tabs || (owner === 'agent' && count('agent') >= settings.agent_max_tabs)) {
      return { ok: false, code: 'tab_limit_reached' }
    }
    const tab = makeTab({ owner, runId, url, origin: owner === 'agent' ? 'agent' : undefined })
    tabs.set(tab.id, tab)
    if (url && (owner === 'agent' || activate)) ensureView(tab)
    if (activate) setActive(tab.id)
    persistSoon()
    changed()
    return { ok: true, tab }
  }

  function setActive(id) {
    const tab = tabs.get(id)
    if (!tab) return false
    activeTabId = id
    tab.lastActiveAt = now()
    if (tab.url) ensureView(tab)
    deps.viewHost.setActive(id)
    changed()
    return true
  }

  /**
   * Navigate `tab` (user input or agent). The caller already ran `checkUrl` for agents.
   * @returns {{ ok: boolean, code?: string }}
   */
  function navigate(tab, rawUrl, actor = 'user') {
    const verdict = deps.checkUrl(rawUrl, actor)
    if (!verdict.ok) return { ok: false, code: verdict.code }
    tab.url = verdict.url
    tab.secure = verdict.url.startsWith('http:') ? 'http' : 'https'
    tab.crashed = false
    const wc = ensureView(tab)
    wc.loadURL(verdict.url).catch(() => {}) // ERR_ABORTED on redirects / our own cancels is expected
    if (tab.id === activeTabId) deps.viewHost.setActive(tab.id)
    changed()
    return { ok: true }
  }

  /** @returns {Promise<{ timedOut: boolean }>} Resolves when the tab stops loading. */
  function whenSettled(tab, timeoutMs = 15_000) {
    return new Promise((resolve) => {
      const wc = tab.wc
      if (!wc || wc.isDestroyed() || (!wc.isLoading() && !tab.loading)) { resolve({ timedOut: false }); return }
      const done = (timedOut) => { clearTimeout(timer); wc.removeListener('did-stop-loading', onStop); resolve({ timedOut }) }
      const onStop = () => done(false)
      const timer = setTimeout(() => done(true), timeoutMs)
      wc.on('did-stop-loading', onStop)
    })
  }

  function close(id, { keepOne = true } = {}) {
    const tab = tabs.get(id)
    if (!tab) return false
    tabs.delete(id)
    if (deps.onTabClosed) deps.onTabClosed(tab)
    deps.viewHost.destroy(id)
    if (activeTabId === id) {
      const next = [...tabs.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
      activeTabId = null
      if (next) setActive(next.id)
      else deps.viewHost.setActive(null)
    }
    if (keepOne && tabs.size === 0) open({})
    persistSoon()
    changed()
    return true
  }

  function reorder(ids) {
    const next = new Map()
    for (const id of ids) if (tabs.has(id)) next.set(id, tabs.get(id))
    for (const [id, tab] of tabs) if (!next.has(id)) next.set(id, tab)
    tabs = next
    persistSoon()
    changed()
  }

  /** Run-ended hook: agent tabs become the user's (spec D-BW2-6). */
  function adoptRun(runId) {
    for (const tab of tabs.values()) {
      if (tab.owner !== 'agent' || tab.runId !== runId) continue
      tab.owner = 'user'
      tab.runId = undefined
      if (tab.wc && !tab.wc.isDestroyed()) { tab.wc.setBackgroundThrottling(true); tab.wc.setAudioMuted(false) }
    }
    const settings = deps.getSettings()
    const spare = [...tabs.values()].filter((t) => t.id !== activeTabId && t.origin === 'agent')
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    while (count() > settings.max_tabs && spare.length) close(spare.shift().id)
    persistSoon()
    changed()
  }

  /**
   * Switch the mounted profile: persist, tear down views, restore dormant tabs.
   * @param {string} nextProfileId
   */
  function mountProfile(nextProfileId) {
    if (profileId) { try { persistNow() } catch { /* best effort */ } }
    for (const id of [...tabs.keys()]) close(id, { keepOne: false })
    profileId = nextProfileId
    activeTabId = null
    let saved = { tabs: [] }
    try { saved = JSON.parse(fs.readFileSync(tabsFile(profileId), 'utf8')) } catch { /* first run */ }
    for (const entry of (saved.tabs || []).slice(0, MAX_PERSISTED)) {
      const verdict = deps.checkUrl(entry.url, 'user')
      if (!verdict.ok) continue
      const fields = { url: verdict.url, title: String(entry.title || '').slice(0, 200) }
      if (typeof entry.id === 'string' && entry.id.length <= 64) fields.id = entry.id
      const tab = makeTab(fields)
      tabs.set(tab.id, tab)
    }
    if (tabs.size === 0) open({ activate: false })
    const first = tabs.get(saved.activeTabId) || tabs.values().next().value
    setActive(first.id)
    changed()
  }

  return {
    open, close, reorder, adoptRun, mountProfile, navigate, whenSettled, ensureView, info, persistNow, setActive,
    get: (id) => tabs.get(id) || null,
    list: () => [...tabs.values()],
    infos: () => [...tabs.values()].map(info),
    activeId: () => activeTabId,
    active: () => tabs.get(activeTabId) || null,
    profileId: () => profileId,
    count,
    agentTabFor: (runId) => [...tabs.values()].find((t) => t.owner === 'agent' && t.runId === runId) || null,
    runTabs: (runId) => [...tabs.values()].filter((t) => t.owner === 'agent' && t.runId === runId),
    drainSpawned(tab) { const ids = tab.spawned; tab.spawned = []; return ids },
    touch: syncFromWebContents,
    /** Set by index.js: cdp release etc. when a tab disappears. */
    setOnTabClosed(fn) { deps.onTabClosed = fn },
  }
}

module.exports = { createTabs, MAX_PERSISTED }
