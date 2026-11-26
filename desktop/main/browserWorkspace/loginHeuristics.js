'use strict'

// loginHeuristics.js — "looks logged in" suggestion for login handoffs (spec iteration 2, W1).
//
// Only SUGGESTS: the user still decides when to press "完成". Cookie VALUES are never read
// (name|domain|path + flags only) and never leave the main process.

const SESSIONISH = /sess|auth|token|sid|login|jwt|uid/i
const NOISE = /csrf|xsrf|_ga|_gid|consent|cookie|lang|locale|track/i
const LOGIN_PATH = /\/(login|signin|sign-in|sso|auth|passport)|account\/login/i
const POLL_MS = 1500
const EVAL_TIMEOUT_MS = 3000
const CONFIRMATIONS = 2 // consecutive truthy polls (multi-step logins flash true once)

/**
 * The ONE place that decides whether a handoff is a login. The backend builds the approval
 * reason as `${kind}:${reason}` (browser_workspace/service.py); captcha/confirm never start a watcher.
 * @param {string} reason
 * @returns {boolean}
 */
function isLoginHandoff(reason) {
  return String(reason || '').startsWith('login:')
}

/** @param {string} url @returns {boolean} */
function isLoginPath(url) {
  try { return LOGIN_PATH.test(new URL(url).pathname) } catch { return false }
}

const keyOf = (c) => `${c.name}|${c.domain}|${c.path}`

/**
 * Session-like cookies that appeared since `baseline` (a Set of name|domain|path keys).
 * @param {Array<{name:string,domain:string,path:string,httpOnly?:boolean}>} cookies
 * @param {Set<string>} baseline
 * @returns {boolean}
 */
function hasNewSessionCookie(cookies, baseline) {
  return cookies.some((c) => !baseline.has(keyOf(c)) && !NOISE.test(c.name) && (c.httpOnly || SESSIONISH.test(c.name)))
}

/** Page-side probe (self-contained, runs in the isolated world). */
function probeVisiblePassword() {
  return Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  })
}

/**
 * @param {object} deps
 * @param {(tab: object) => Promise<object[]>} deps.getCookies Whole-partition cookies of the tab's profile.
 * @param {(tab: object, expression: string, timeoutMs: number) => Promise<unknown>} deps.evaluate
 * @param {(approvalId: string) => void} deps.onSuggest
 * @param {typeof setInterval} [deps.setTimer]
 * @param {typeof clearInterval} [deps.clearTimer]
 * @returns {{ start: (approval: object, tab: object) => Promise<void>, stop: (id: string) => void, stopAll: () => void }}
 */
function createLoginWatchers(deps) {
  const setTimer = deps.setTimer || setInterval
  const clearTimer = deps.clearTimer || clearInterval
  /** @type {Map<string, { timer: any, stopped: boolean }>} */
  const watchers = new Map()

  function stop(id) {
    const watcher = watchers.get(id)
    if (!watcher) return
    watcher.stopped = true
    clearTimer(watcher.timer)
    watchers.delete(id)
  }

  async function looksLoggedIn(tab, baseline, startedOnLoginPage) {
    const cookies = await deps.getCookies(tab)
    if (!hasNewSessionCookie(cookies, baseline)) return false
    if (startedOnLoginPage && isLoginPath(tab.url)) return false
    const hasPassword = await deps.evaluate(tab, `(${probeVisiblePassword.toString()})()`, EVAL_TIMEOUT_MS)
    return hasPassword === false
  }

  async function start(approval, tab) {
    if (!approval || !tab || !isLoginHandoff(approval.reason) || watchers.has(approval.id)) return
    const watcher = { timer: null, stopped: false }
    watchers.set(approval.id, watcher)
    let baseline
    try {
      baseline = new Set((await deps.getCookies(tab)).map(keyOf))
    } catch { stop(approval.id); return }
    const startedOnLoginPage = isLoginPath(tab.url)
    let streak = 0
    let busy = false
    watcher.timer = setTimer(async () => {
      if (watcher.stopped || busy) return
      busy = true
      try {
        streak = (await looksLoggedIn(tab, baseline, startedOnLoginPage)) ? streak + 1 : 0
      } catch { streak = 0 }
      busy = false
      if (watcher.stopped || streak < CONFIRMATIONS) return
      stop(approval.id)
      deps.onSuggest(approval.id)
    }, POLL_MS)
    if (watcher.timer && watcher.timer.unref) watcher.timer.unref()
  }

  return { start, stop, stopAll: () => [...watchers.keys()].forEach(stop) }
}

module.exports = { createLoginWatchers, isLoginHandoff, isLoginPath, hasNewSessionCookie, POLL_MS, CONFIRMATIONS }
