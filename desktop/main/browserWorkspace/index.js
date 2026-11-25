'use strict'

// browserWorkspace/index.js — assembly of the Agent browser workspace (spec §4.2.1).
// Blueprint: docs/plans/agent-browser-workspace/spec.md (v2), §4.1 architecture.
//
// The main process owns ALL browser state (profiles, tabs, control, approvals); the
// renderer mirrors it over IPC and the FastAPI backend drives it over a loopback
// control server. `createBrowserWorkspace` only wires the parts — keep logic in the
// modules so each stays unit-testable without Electron (`electron` is injected).

const path = require('path')
const crypto = require('crypto')
const { createProfiles, partitionFor } = require('./profiles')
const { createStateStore } = require('./stateStore')
const { createApprovals, publicView } = require('./approvals')
const { createControl } = require('./control')
const { createViewHost } = require('./viewHost')
const { createTabs } = require('./tabs')
const { createHardening } = require('./hardening')
const { attachCookiePersister } = require('./cookiePersister')
const { createCdpEngine } = require('./cdpEngine')
const { createActions } = require('./actions')
const { createRiskGate, WorkspaceError } = require('./approvalGate')
const { createControlServer, errorResponse } = require('./controlServer')
const { createResourceFetcher } = require('./resourceFetch')
const { registerBrowserIpc } = require('./bridge')
const { createWorkspaceApi } = require('./workspaceApi')
const { createSettingsReader } = require('./settings')
const { attachShortcuts } = require('./viewShortcuts')
const { attachContextMenu } = require('./contextMenu')
const { checkUrl: guardCheckUrl } = require('./navigationGuard')
const { hideAgentOverlay, buildCall } = require('./pageScripts')

const STATE_CHANNEL = 'browser:state-changed'
const ACTIVITY_CHANNEL = 'browser:activity'
const SAVE_CHANNEL = 'browser:save-resource-request'
const SHORTCUT_CHANNEL = 'browser:shortcut'

/**
 * Switches that must be set BEFORE `app.ready` (spec §4.2.3 R1-3): without them Chromium
 * throttles renderers of an occluded / minimised window, which would freeze Agent actions.
 * @param {{ commandLine: { appendSwitch: (name: string) => void } }} app
 */
function applyEarlySwitches(app) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
}

/**
 * The identity gate lets the window through only when authenticated and not forced to
 * change the password (or the gate is switched off). Anything else → views must vanish.
 * @param {object|null} status AuthStatus.
 * @returns {boolean}
 */
function isGatePassed(status) {
  if (!status) return false
  if (status.source === 'gate-disabled') return true
  return status.state === 'authenticated' && !status.mustChangePassword
}

/**
 * @param {object} options
 * @param {object} options.electron `require('electron')` (injectable for tests).
 * @param {object} options.state main/index.js module state, read lazily: userDataPath, logger,
 *   authController, frontendPort, backendPort, researchBrowserPorts, researchBrowserEnv, mainWindow.
 * @param {boolean} [options.isDev]
 */
function createBrowserWorkspace({ electron, state, isDev = false }) {
  // `state.logger` is a class instance (prototype methods), so wrap instead of spreading it.
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) =>
    [level, (category, message) => (state.logger ? state.logger[level](category, message) : undefined)]))
  const log = (level, msg) => logger[level]('browser', msg)
  const dir = path.join(state.userDataPath, 'browser-workspace')
  const token = crypto.randomBytes(32).toString('hex')
  const consentOnce = new Set() // `${runId}|${profileId}` for "仅本次"
  const scopeAllowed = new Set() // `${runId}|${host}` for "本轮内允许此站点同类操作"
  const approvalProfile = new Map() // consent approvalId → profileId
  const recentApprovals = new Map() // `${runId}|${host}|${label}` → ms, risky approvals the user just allowed
  const sessions = new Map() // partition → { persister }
  let controlPort = 0
  let locked = state.authController ? !isGatePassed(safeStatus()) : false
  let unsubscribeAuth = null
  let win = null
  let idleTimer = null
  let ipc = null
  const loginCounts = new Map()

  function safeStatus() {
    try { return state.authController.status() } catch { return null }
  }
  const backendUrl = () => `http://127.0.0.1:${state.backendPort || 8000}`
  const settings = createSettingsReader({ getBackendUrl: backendUrl, logger })
  const getWin = () => (win && !win.isDestroyed() ? win : null)
  const send = (channel, payload) => { const w = getWin(); if (w) w.webContents.send(channel, payload) }
  const frontendOrigins = () => {
    const port = state.frontendPort || 3000
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
  }
  const ownPorts = () => {
    const research = state.researchBrowserPorts || {}
    return [state.frontendPort || 3000, state.backendPort || 8000, controlPort, research.cdpPort, research.controlPort,
      state.effectsConfig && state.effectsConfig.effectsPort].filter(Boolean)
  }
  const proxyRules = () => (state.researchBrowserEnv && state.researchBrowserEnv.WEB_RESEARCH_SYSTEM_PROXY) || null

  function checkUrl(url, actor) {
    const s = settings.get()
    return guardCheckUrl(url, { actor, allowPrivate: Boolean(s.agent_allow_private_network), ownPorts: ownPorts(), denyHosts: s.agent_deny_hosts })
  }

  const getSession = (partition) => electron.session.fromPartition(partition)

  // ---- state ---------------------------------------------------------------
  const stateStore = createStateStore({
    broadcast: (snapshot) => send(STATE_CHANNEL, snapshot),
    broadcastActivity: (entry) => send(ACTIVITY_CHANNEL, entry),
    collect: () => {
      const s = settings.get()
      return {
        available: !locked, enabled: s.enabled, agentEnabled: s.agent_enabled, activeProfileId: profiles.activeId(),
        profiles: profiles.list().map((p) => ({
          id: p.id, name: p.name, color: p.color, loginSiteCount: loginCounts.get(p.id) || 0, agentConsent: Boolean(p.agentConsentAt),
        })),
        tabs: locked ? [] : tabs.infos(), activeTabId: tabs.activeId(), control: control.view(),
        approvals: approvals.pending(), locked,
      }
    },
  })
  const touch = () => stateStore.touch()

  const profiles = createProfiles({
    dir,
    onChange: touch,
    clearSession: async (partition) => {
      const ses = getSession(partition)
      await ses.clearStorageData()
      await ses.clearCache()
      await ses.clearAuthCache()
    },
  })

  const approvals = createApprovals({
    onChange: (approval) => {
      if (approval.kind === 'handoff' && approval.status !== 'pending') control.returnControl()
      touch()
    },
    onResolved: (approval, decision) => {
      // Only the BACKEND's pre-confirmation is reusable; a yes the main gate asked itself must not leak into a re-ask.
      if (approval.kind === 'risky_action' && approval.origin === 'backend' && decision !== 'deny' && approval.target) {
        recentApprovals.set(`${approval.runId}|${approval.target.host}|${approval.target.label}`, Date.now())
        if (recentApprovals.size > 200) recentApprovals.clear()
      }
      if (approval.kind !== 'consent' || decision === 'deny') return
      const profileId = approvalProfile.get(approval.id) || profiles.activeId()
      if (decision === 'approve_scope') profiles.setConsent(profileId)
      else consentOnce.add(`${approval.runId}|${profileId}`)
    },
  })

  const consentGranted = (runId) => {
    const profile = profiles.active()
    return Boolean(profile.agentConsentAt) || consentOnce.has(`${runId}|${profile.id}`)
  }

  const viewHost = createViewHost({ WebContentsView: electron.WebContentsView, getWin })
  const cdp = createCdpEngine({ logger })

  const control = createControl({
    getSettings: () => settings.get(), hasPendingApproval: () => approvals.hasPending(), onChange: touch,
    onReleased: (runId) => releaseRunResources(runId),
  })

  function releaseRunResources(runId) {
    const agentTabs = tabs.runTabs(runId)
    for (const tab of agentTabs) {
      if (cdp.isAttached(tab.id)) cdp.evalIsolated(tab.id, buildCall(hideAgentOverlay)).catch(() => {})
    }
    tabs.adoptRun(runId)
    approvals.cancelRun(runId)
    for (const key of [...consentOnce, ...scopeAllowed]) if (key.startsWith(`${runId}|`)) { consentOnce.delete(key); scopeAllowed.delete(key) }
    touch()
  }

  // ---- sessions & tabs -----------------------------------------------------
  const hardening = createHardening({
    getOwnPorts: ownPorts, getSettings: () => settings.get(), getProxyRules: proxyRules, locale: electron.app && electron.app.getLocale && electron.app.getLocale(),
    isAgentWebContents: (id) => tabs.list().some((t) => t.owner === 'agent' && t.wc && !t.wc.isDestroyed() && t.wc.id === id),
    onBlocked: ({ reason }) => {
      if (reason === 'download_blocked') {
        stateStore.pushActivity({ kind: 'notice', label: '浏览器内不直接下载。图片/视频请右键「保存到素材库」，或让 Agent 保存' })
      } else log('debug', `request blocked: ${reason}`)
    },
  })

  function prepareSession(partition) {
    if (sessions.has(partition)) return
    const ses = getSession(partition)
    hardening.install(ses)
    const persister = attachCookiePersister(ses, { getTtlDays: () => settings.get().session_cookie_ttl_days, logger })
    persister.scan().catch(() => {})
    sessions.set(partition, { persister })
  }

  function handleShortcut(action) {
    const tab = tabs.active()
    if (action === 'new-tab') { tabs.open({}); send(SHORTCUT_CHANNEL, { action: 'focus-address' }); return }
    if (action === 'close-tab' && tab) { tabs.close(tab.id); return }
    if (action === 'reload' && tab) { api.reload(tab.id); return }
    if (action === 'back' && tab) { api.back(tab.id); return }
    if (action === 'forward' && tab) { api.forward(tab.id); return }
    if (action === 'next-tab' || action === 'prev-tab') {
      const list = tabs.list()
      const index = list.findIndex((t) => t.id === tabs.activeId())
      const step = action === 'next-tab' ? 1 : -1
      tabs.setActive(list[(index + step + list.length) % list.length].id)
      return
    }
    send(SHORTCUT_CHANNEL, { action })
  }

  function onWebContents(tab, wc) {
    attachShortcuts(wc, handleShortcut)
    attachContextMenu(wc, {
      Menu: electron.Menu, tab, getWin,
      handlers: {
        back: () => api.back(tab.id), forward: () => api.forward(tab.id), reload: () => api.reload(tab.id),
        selectAll: () => wc.selectAll(), copyText: (text) => electron.clipboard.writeText(String(text)),
        copyImage: (x, y) => wc.copyImageAt(x, y),
        openInNewTab: (url) => { const verdict = checkUrl(url, 'user'); if (verdict.ok) tabs.open({ url: verdict.url, owner: 'user', activate: true }) },
        saveResource: ({ url, kind }) => send(SAVE_CHANNEL, { tabId: tab.id, url, kind }),
      },
    })
  }

  const tabs = createTabs({
    viewHost, profiles, dir, getSettings: () => settings.get(), checkUrl, prepareSession, onChange: touch, onWebContents, getWin, logger,
  })
  tabs.setOnTabClosed((tab) => cdp.release(tab.id))

  // ---- agent side ----------------------------------------------------------
  const hasProfileCookies = async (host) => {
    if (!host) return false
    const cookies = await getSession(partitionFor(profiles.activeId())).cookies.get({}).catch(() => [])
    return cookies.some((c) => { const h = String(c.domain).replace(/^\./, ''); return host === h || host.endsWith(`.${h}`) })
  }
  const riskGate = createRiskGate({ approvals, scopeAllowed, recentApprovals, getSettings: () => settings.get(), hasProfileCookies })
  const actions = createActions({
    tabs, cdp, viewHost, control, stateStore, profiles, riskGate, checkUrl, getSettings: () => settings.get(),
    isConsentGranted: consentGranted, hasProfileCookies, logger,
  })
  cdp.onUserInput(() => control.userInput())
  cdp.onDialog((tabId, params) => actions.onDialog(tabId, params))
  cdp.onFileChooser((tabId) => actions.onFileChooser(tabId))
  const fetcher = createResourceFetcher({ net: electron.net, sessionFor: getSession, tabs, profiles, cdp, checkUrl })

  const api = createWorkspaceApi({
    tabs, profiles, control, approvals, viewHost, stateStore, getSession, checkUrl, consentOnce,
    onProfileChanged: () => { refreshLoginCounts(); touch() },
  })

  async function refreshLoginCounts() {
    for (const p of profiles.list()) loginCounts.set(p.id, await api.countLoginSites(p.id).catch(() => 0))
    touch()
  }

  // ---- control server handlers --------------------------------------------
  function approvalCreate(body) {
    const profile = profiles.active()
    if (body.kind === 'consent' && consentGranted(body.run_id)) return { approval_id: null, already_granted: true }
    const approval = approvals.create({
      kind: body.kind, runId: body.run_id, reason: String(body.reason || '').slice(0, 200),
      dedupeKey: body.kind === 'consent' ? `${body.run_id}|${profile.id}` : undefined,
      target: body.kind === 'consent' ? { host: '', label: profile.name } : body.target && { host: String(body.target.host || '').slice(0, 253), label: String(body.target.label || '').slice(0, 80) },
    })
    approval.origin = 'backend'
    if (body.kind === 'consent') approvalProfile.set(approval.id, profile.id)
    if (body.kind === 'handoff') {
      control.takeOver()
      const handoffTab = (typeof body.tab_id === 'string' && tabs.get(body.tab_id)) || tabs.agentTabFor(body.run_id)
      if (handoffTab) tabs.setActive(handoffTab.id)
      stateStore.pushActivity({ kind: 'handoff', label: `请你完成：${String(body.reason || '').slice(0, 50)}` })
    }
    return { approval_id: approval.id }
  }

  const handlers = {
    health: (runId) => ({
      ok: true, version: 1, profile: { id: profiles.activeId(), name: profiles.active().name }, tabs: tabs.count(), locked,
      enabled: settings.get().enabled, agent_enabled: settings.get().agent_enabled,
      consent: { granted: runId ? consentGranted(runId) : Boolean(profiles.active().agentConsentAt), profile_id: profiles.activeId() },
    }),
    command: async (cmd, signal) => {
      const s = settings.get()
      if (!s.enabled || !s.agent_enabled) throw new WorkspaceError('workspace_disabled')
      return actions.execute(cmd, signal)
    },
    release: (runId) => { control.release(runId); releaseRunResources(runId) },
    approvalCreate,
    approvalGet: (id, waitMs) => approvals.wait(id, waitMs),
    approvalCancel: (id) => approvals.cancel(id),
    fetchResource: async (body, signal) => {
      try {
        return await fetcher.fetchResource(body, signal)
      } catch (err) {
        const r = errorResponse(err)
        return { status: r.status, headers: {}, body: Buffer.from(JSON.stringify(r.body)) }
      }
    },
  }
  const server = createControlServer({ token, isLocked: () => locked, handlers, logger })

  // ---- lifecycle -----------------------------------------------------------
  function setLocked(next) {
    if (locked === next) return
    locked = next
    viewHost.setLocked(next)
    if (next) {
      approvals.cancelAll()
      server.abortAll()
    } else {
      viewHost.resetForRendererReload() // renderer must re-send bounds before any view returns
    }
    stateStore.flush()
  }

  function bindWindow(target) {
    win = target
    const reconcile = () => viewHost.reconcile()
    for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen']) target.on(event, reconcile)
    // Native views live in contentView and would outlive a renderer reload (HMR/crash): clear them first.
    target.webContents.on('did-start-navigation', (...args) => {
      const d = args[0] && typeof args[0] === 'object' && 'isMainFrame' in args[0] ? args[0] : { isMainFrame: args[3], isSameDocument: args[2] }
      if (d.isMainFrame && !d.isSameDocument) viewHost.resetForRendererReload()
    })
    target.on('closed', () => { win = null })
    if (electron.screen) electron.screen.on('display-metrics-changed', reconcile)
    viewHost.reconcile()
  }

  return {
    /** @returns {Promise<{ env: Record<string,string>|null, error?: string }>} Env for the backend child. */
    async start() {
      try {
        controlPort = await server.start()
        tabs.mountProfile(profiles.activeId())
        ipc = registerBrowserIpc({ ipcMain: electron.ipcMain, workspace: { ...api, getState: stateStore.getState }, getFrontendOrigins: frontendOrigins, logger })
        if (state.authController) {
          unsubscribeAuth = state.authController.on((status) => setLocked(!isGatePassed(status)))
          locked = !isGatePassed(safeStatus())
          viewHost.setLocked(locked)
        }
        idleTimer = setInterval(() => control.tick(), 5000)
        idleTimer.unref()
        refreshLoginCounts().catch(() => {})
        log('info', `browser workspace ready (control=127.0.0.1:${controlPort}, locked=${locked}, dev=${isDev})`)
        return { env: { BROWSER_WORKSPACE_CONTROL_URL: `http://127.0.0.1:${controlPort}`, BROWSER_WORKSPACE_CONTROL_TOKEN: token } }
      } catch (err) {
        log('warn', `browser workspace unavailable — Agent falls back to the isolated browser: ${(err && err.message) || err}`)
        return { env: null, error: String((err && err.message) || err) }
      }
    },
    attachWindow: bindWindow,
    setLocked,
    getState: stateStore.getState,
    async stop() {
      clearInterval(idleTimer)
      if (unsubscribeAuth) unsubscribeAuth()
      try { tabs.persistNow() } catch { /* best effort at quit */ }
      for (const { persister } of sessions.values()) { await persister.flush(); persister.detach() }
      viewHost.destroyAll()
      if (ipc) ipc.dispose()
      await server.stop()
    },
    // exposed for tests / diagnostics only — never returns the token
    _internals: { tabs, profiles, approvals, control, actions, handlers, checkUrl, viewHost, refreshSettings: () => settings.refresh() },
    publicApproval: publicView,
  }
}

module.exports = { createBrowserWorkspace, applyEarlySwitches, isGatePassed }
