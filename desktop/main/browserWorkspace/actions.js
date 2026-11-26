'use strict'

// actions.js — executes one backend command against a real tab (spec §4.2.5, §6.2).
//
// Shape of every command: acquire control → mark the view agent-busy (so it stays
// paintable even when the user cannot see it, R1-3) → run inside the tab's FIFO queue →
// log activity (never typed text) → release the busy flag after the 150 ms tail.

const { WorkspaceError } = require('./approvalGate')
const input = require('./inputEvents')
const scripts = require('./pageScripts')

const SNAPSHOT_TIMEOUT_MS = 8000
const NAV_WAIT_MS = 20_000

const hostOf = (url) => { try { return new URL(url).hostname } catch { return '' } }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clampInt = (value, lo, hi, fallback) => (Number.isFinite(Number(value)) ? Math.min(hi, Math.max(lo, Math.round(Number(value)))) : fallback)

/**
 * @param {object} deps tabs, cdp, viewHost, control, riskGate, stateStore, profiles, getSettings,
 *   checkUrl, isConsentGranted(runId), logger
 */
function createActions(deps) {
  const { tabs, cdp, viewHost, control, stateStore } = deps

  function agentTab(cmd) {
    const tab = tabs.get(cmd.tab_id)
    if (!tab || tab.owner !== 'agent' || tab.runId !== cmd.run_id) throw new WorkspaceError('browser_session_lost')
    if (tab.crashed) throw new WorkspaceError('tab_crashed')
    return tab
  }

  function evalPage(tab, fn, arg, timeoutMs) {
    return cdp.evalIsolated(tab.id, scripts.buildCall(fn, arg), { timeoutMs })
  }

  function snapshotArgs(args, tab) {
    const settings = deps.getSettings()
    return {
      version: tab.snapshotVersion, budgetMs: 250, fullBytes: 200_000,
      maxElements: clampInt(args.max_elements ?? args.elements_max, 20, 120, settings.max_elements),
      maxBytes: clampInt(args.max_bytes, 500, 8000, 4000),
    }
  }

  /**
   * Main-content extraction rides on the SAME snapshot command (spec D-A3), so it inherits
   * SNAPSHOT_TIMEOUT_MS instead of adding a timeout tier. Clamped here AND in the backend.
   * A page-script failure returns a code, never an exception: the plain snapshot is mainline.
   */
  async function extractArticle(tab, args) {
    const opts = { blocks_from: clampInt(args.article_from, 0, 399, 0),
      blocks_max: clampInt(args.article_blocks, 1, 40, 12) }
    let payload
    try {
      payload = await evalPage(tab, scripts.extractArticle, opts, SNAPSHOT_TIMEOUT_MS)
    } catch {
      return { ok: false, code: 'page_script_error' }
    }
    if (payload && payload.ok) recordArticle(tab, payload.article)
    return payload
  }

  // The rail entry is pushed HERE, not from `runOnTab`: that maps `cmd.type` to an activity
  // label at command start, when the extraction result does not exist yet (spec P1-6).
  function recordArticle(tab, article) {
    if (!article) return
    stateStore.pushActivity({
      kind: 'article', tabId: tab.id, label: String(article.title || '\u6b63\u6587').slice(0, 80),
      articleMeta: { title: String(article.title || ''), site: String(article.site || ''),
        publishedAt: article.published_at || null, totalBlocks: Number(article.total_blocks) || 0,
        chars: Number(article.char_count) || 0 } })
  }

  async function takeSnapshot(tab, args = {}) {
    tab.snapshotVersion = (tab.snapshotVersion || 0) + 1
    const snap = await evalPage(tab, scripts.snapshotPage, snapshotArgs(args, tab), SNAPSHOT_TIMEOUT_MS)
    if (args.article === true) snap.article = await extractArticle(tab, args)
    tabs.touch(tab)
    return {
      tab_id: tab.id, snapshot_version: tab.snapshotVersion, ...snap, profile: { name: deps.profiles.active().name },
      control: { holder: control.holder() }, has_profile_cookies: await deps.hasProfileCookies(hostOf(snap.url)),
    }
  }

  /** After a mutating action: wait for navigation + DOM quiet; detect world reset. */
  async function settle(tab, before, signal) {
    await sleep(120)
    if (signal && signal.aborted) throw new WorkspaceError('command_cancelled')
    let settled = true
    if (tab.wc.isLoading()) settled = !(await tabs.whenSettled(tab, 8000)).timedOut
    const quiet = await evalPage(tab, scripts.waitDomQuiet, { quietMs: 250, maxMs: 3000 }, 6000).catch(() => false)
    const alive = await cdp.evalIsolated(tab.id, '(globalThis.__ecx ? globalThis.__ecx.version : null)').catch(() => null)
    const navigated = alive === null || alive !== tab.snapshotVersion
    if (navigated) tab.snapshotVersion = (tab.snapshotVersion || 0) + 1
    tabs.touch(tab)
    const result = {
      tab_id: tab.id, snapshot_version: tab.snapshotVersion, url: tab.url, title: tab.title,
      changed: navigated || tab.url !== before.url, settled: settled && quiet,
    }
    const spawned = tabs.drainSpawned(tab)
    if (spawned.length) result.new_tabs = spawned
    if (tab.lastDialog) { result.dialog = tab.lastDialog; tab.lastDialog = null }
    if (tab.fileChooserBlocked) { tab.fileChooserBlocked = false; throw new WorkspaceError('file_chooser_blocked') }
    return result
  }

  async function prepare(tab, args, intent) {
    const prep = await evalPage(tab, scripts.prepareTarget, { ref: args.element_ref, expectVersion: args.snapshot_version, intent }, 8000)
    if (!prep.ok) throw new WorkspaceError(prep.code, prep.details)
    return prep
  }

  async function showCursor(tab, prep, label) {
    if (!viewHost.isOnScreen(tab.id)) return
    await evalPage(tab, scripts.showAgentCursor, { x: prep.x, y: prep.y, rect: prep.rect, label }, 3000).catch(() => {})
    await sleep(260)
  }

  async function riskCheck(ctx, kind, target) {
    await deps.riskGate.check({
      runId: ctx.cmd.run_id, kind, host: hostOf(ctx.tab.url), target, autonomy: ctx.cmd.args.autonomy,
    }, ctx.signal)
  }

  const handlers = {
    async snapshot(ctx) { return takeSnapshot(ctx.tab, ctx.cmd.args) },

    async click(ctx) {
      const before = { url: ctx.tab.url }
      const prep = await prepare(ctx.tab, ctx.cmd.args, 'click')
      ctx.describe(`点击 · ${prep.name}`)
      await riskCheck(ctx, 'click', prep.risk)
      await showCursor(ctx.tab, prep, `点击 · ${prep.name}`.slice(0, 40))
      await input.clickAt((m, p) => cdp.send(ctx.tab.id, m, p), prep.x, prep.y)
      return settle(ctx.tab, before, ctx.signal)
    },

    async hover(ctx) {
      const prep = await prepare(ctx.tab, ctx.cmd.args, 'hover')
      ctx.describe(`悬停 · ${prep.name}`)
      await showCursor(ctx.tab, prep, `悬停 · ${prep.name}`.slice(0, 40))
      await input.hoverAt((m, p) => cdp.send(ctx.tab.id, m, p), prep.x, prep.y)
      return settle(ctx.tab, { url: ctx.tab.url }, ctx.signal)
    },

    async fill(ctx) {
      const text = String(ctx.cmd.args.text ?? '')
      if (text.length > input.MAX_FILL_CHARS) throw new WorkspaceError('invalid_argument', { field: 'text' })
      ctx.describe(`输入 ${text.length} 个字符`)
      const prep = await prepare(ctx.tab, ctx.cmd.args, 'fill')
      await showCursor(ctx.tab, prep, `输入 ${text.length} 个字符`)
      await input.insertText((m, p) => cdp.send(ctx.tab.id, m, p), text)
      return settle(ctx.tab, { url: ctx.tab.url }, ctx.signal)
    },

    async press(ctx) {
      const { key, element_ref: ref } = ctx.cmd.args
      if (!input.isAllowedKey(key)) throw new WorkspaceError('invalid_argument', { field: 'key' })
      if (ref) await prepare(ctx.tab, ctx.cmd.args, 'focus')
      if (key === 'Enter') {
        const focus = await evalPage(ctx.tab, scripts.describeFocus, undefined, 3000)
        await riskCheck(ctx, 'press_enter', { name: focus.name, formAction: focus.formAction, formMethod: focus.formMethod })
      }
      await input.pressKey((m, p) => cdp.send(ctx.tab.id, m, p), key)
      return settle(ctx.tab, { url: ctx.tab.url }, ctx.signal)
    },

    async scroll(ctx) {
      const before = await evalPage(ctx.tab, scripts.readScroll, undefined, 3000)
      const delta = Math.max(-input.MAX_WHEEL_DELTA, Math.min(input.MAX_WHEEL_DELTA, Math.round(Number(ctx.cmd.args.delta_y) || 0)))
      const w = Math.round(deps.viewHost.model.lastViewport.width / 2)
      await input.wheel((m, p) => cdp.send(ctx.tab.id, m, p), w, Math.round(before.viewport_h / 2), delta)
      let after = before
      for (let i = 0; i < 6 && after.scroll_y === before.scroll_y; i += 1) {
        await sleep(100)
        after = await evalPage(ctx.tab, scripts.readScroll, undefined, 3000)
      }
      if (after.scroll_y === before.scroll_y && delta !== 0) {
        // A parked (mostly clipped) view can swallow wheel input: scroll the document directly.
        await evalPage(ctx.tab, scripts.scrollByAmount, { dy: delta }, 3000)
        after = await evalPage(ctx.tab, scripts.readScroll, undefined, 3000)
      }
      return { tab_id: ctx.tab.id, snapshot_version: ctx.tab.snapshotVersion, url: ctx.tab.url, changed: after.scroll_y !== before.scroll_y, settled: true, scroll: after }
    },

    async select(ctx) {
      const { element_ref: ref, snapshot_version: version, option_text: optionText, value } = ctx.cmd.args
      const res = await evalPage(ctx.tab, scripts.selectOption, { ref, expectVersion: version, option_text: optionText, value }, 5000)
      if (!res.ok) throw new WorkspaceError(res.code, res.details)
      return settle(ctx.tab, { url: ctx.tab.url }, ctx.signal)
    },

    async back(ctx) { return navigateHistory(ctx, 'goBack') },
    async forward(ctx) { return navigateHistory(ctx, 'goForward') },
    async reload(ctx) { return navigateHistory(ctx, 'reload') },

    async wait(ctx) {
      const a = ctx.cmd.args
      const res = await evalPage(ctx.tab, scripts.waitCondition, {
        ms: a.ms ? clampInt(a.ms, 0, 5000, 0) : undefined, until_text: a.until_text, until_gone_text: a.until_gone_text,
        timeout_ms: clampInt(a.timeout_ms, 0, 15_000, 5000),
      }, clampInt(a.timeout_ms, 0, 15_000, 5000) + 3000)
      return { tab_id: ctx.tab.id, snapshot_version: ctx.tab.snapshotVersion, url: ctx.tab.url, matched: res.matched, settled: true }
    },

    async images(ctx) {
      const images = await evalPage(ctx.tab, scripts.collectImages, { limit: 100 }, 5000)
      return { tab_id: ctx.tab.id, url: ctx.tab.url, final_url: ctx.tab.url, title: ctx.tab.title, images }
    },

    async screenshot(ctx) {
      for (const quality of [70, 40]) {
        let shot
        try {
          shot = await cdp.send(ctx.tab.id, 'Page.captureScreenshot', { format: 'jpeg', quality }, 4000)
        } catch {
          throw new WorkspaceError('screenshot_unavailable', { hint: '窗口被最小化时无法截图，请还原窗口' })
        }
        if (shot.data.length <= 2_800_000) return { tab_id: ctx.tab.id, mime: 'image/jpeg', image_b64: shot.data }
      }
      throw new WorkspaceError('screenshot_too_large')
    },

    async close_tab(ctx) {
      tabs.close(ctx.tab.id)
      if (tabs.runTabs(ctx.cmd.run_id).length === 0) control.release(ctx.cmd.run_id)
      return { closed: true }
    },
  }

  async function navigateHistory(ctx, method) {
    const nav = ctx.tab.wc.navigationHistory
    const before = { url: ctx.tab.url }
    if (method === 'reload') ctx.tab.wc.reload()
    else if (method === 'goBack' ? nav.canGoBack() : nav.canGoForward()) nav[method]()
    await tabs.whenSettled(ctx.tab, NAV_WAIT_MS)
    return settle(ctx.tab, before, ctx.signal)
  }

  async function open(cmd, signal) {
    if (!deps.isConsentGranted(cmd.run_id)) throw new WorkspaceError('consent_required')
    const verdict = deps.checkUrl(cmd.args.url, 'agent')
    if (!verdict.ok) throw new WorkspaceError(verdict.code, { sticky: verdict.sticky })
    let tab = cmd.args.new_tab ? null : tabs.agentTabFor(cmd.run_id)
    if (!tab) {
      const made = tabs.open({ owner: 'agent', runId: cmd.run_id, activate: false })
      if (!made.ok) throw new WorkspaceError(made.code)
      tab = made.tab
    }
    tabs.ensureView(tab)
    return runOnTab(cmd, tab, signal, async (ctx) => {
      const nav = tabs.navigate(tab, verdict.url, 'agent')
      if (!nav.ok) throw new WorkspaceError(nav.code)
      await tabs.whenSettled(tab, NAV_WAIT_MS)
      await settle(tab, { url: '' }, signal)
      return takeSnapshot(tab, ctx.cmd.args)
    }, { label: `打开 · ${hostOf(verdict.url)}`, kind: 'open' })
  }

  const ACTIVITY = {
    snapshot: ['read', '读取页面'], click: ['click', '点击'], hover: ['click', '悬停'], fill: ['fill', '输入文字'],
    press: ['press', '按键'], scroll: ['scroll', '滚动'], select: ['click', '选择选项'], back: ['click', '后退'],
    forward: ['click', '前进'], reload: ['read', '刷新'], wait: ['wait', '等待'], images: ['read', '提取图片'],
    screenshot: ['read', '截图'], close_tab: ['close', '关闭页签'],
  }

  async function runOnTab(cmd, tab, signal, fn, activity) {
    const [kind, label] = activity ? [activity.kind, activity.label] : ACTIVITY[cmd.type]
    const entry = stateStore.pushActivity({ kind, label, status: 'running' })
    const startedAt = Date.now()
    viewHost.setAgentBusy(tab.id, true)
    control.begin()
    try {
      const result = await cdp.enqueue(tab.id, async () => {
        await cdp.ensure(tab.id, tab.wc)
        tab.fileChooserBlocked = false
        await cdp.setFileChooserIntercept(tab.id, true)
        try {
          if (deps.getSettings().follow_agent && tabs.activeId() !== tab.id && Date.now() - control.lastUserInputAt() > 8000) tabs.setActive(tab.id)
          return await fn({ cmd, tab, signal, describe: (text) => stateStore.updateActivity(entry.id, { label: String(text).slice(0, 80) }) })
        } finally {
          await cdp.setFileChooserIntercept(tab.id, false)
        }
      }, signal)
      stateStore.updateActivity(entry.id, { status: 'ok', durationMs: Date.now() - startedAt })
      return result
    } catch (err) {
      stateStore.updateActivity(entry.id, { status: 'error', durationMs: Date.now() - startedAt, errorCode: err.code || 'internal_error' })
      throw err
    } finally {
      control.end()
      setTimeout(() => viewHost.setAgentBusy(tab.id, false), 150).unref()
    }
  }

  /**
   * Run one backend command.
   * @param {{ id: string, run_id: string, tab_id?: string, type: string, args?: object }} cmd
   * @param {AbortSignal} signal Aborted by DELETE /v1/commands/{id}.
   * @returns {Promise<object>} Result JSON.
   * @throws {WorkspaceError}
   */
  async function execute(cmd, signal) {
    cmd.args = cmd.args || {}
    const got = control.acquire(cmd.run_id)
    if (!got.ok) throw new WorkspaceError(got.code)
    if (cmd.type === 'open') return open(cmd, signal)
    const handler = handlers[cmd.type]
    if (!handler) throw new WorkspaceError('unsupported_command', { type: cmd.type })
    const tab = agentTab(cmd)
    if (!tab.wc || tab.wc.isDestroyed()) throw new WorkspaceError('tab_closed')
    return runOnTab(cmd, tab, signal, handler)
  }

  /** Dialog policy while an agent holds the tab (spec §4.2.5 R2-3). @returns {boolean|undefined} */
  function onDialog(tabId, params) {
    const tab = tabs.get(tabId)
    if (!tab || tab.owner !== 'agent' || control.holder() !== 'agent') return undefined
    tab.lastDialog = { type: params.type, message: String(params.message || '').slice(0, 120) }
    stateStore.pushActivity({ kind: 'notice', label: `页面弹窗已关闭：${String(params.message || '').slice(0, 40)}` })
    return params.type === 'beforeunload'
  }

  function onFileChooser(tabId) {
    const tab = tabs.get(tabId)
    if (tab) tab.fileChooserBlocked = true
  }

  return { execute, onDialog, onFileChooser, takeSnapshot, handlers: Object.keys(handlers) }
}

module.exports = { createActions, hostOf }
