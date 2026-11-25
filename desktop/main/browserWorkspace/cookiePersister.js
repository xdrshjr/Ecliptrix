'use strict'

// cookiePersister.js — session-cookie renewal (spec §4.2.4, D-BW2-5).
//
// Why: Chromium drops cookies without an expiry when the app exits, and many sites
// (weibo / zhihu / bilibili back offices) keep users logged in with exactly such
// cookies. Re-writing them with a finite expiry is what makes "cached login" real.
// Known limit: cookies that were session-only BEFORE a crash are already gone and
// cannot be recovered — only this run's cookies are renewed.

const DEDUPE_WINDOW_MS = 200
const FLUSH_INTERVAL_MS = 60_000
const DAY_S = 86_400

/**
 * @param {object} cookie Electron Cookie.
 * @returns {string} URL the cookie is valid for (needed by cookies.set).
 */
function buildCookieUrl(cookie) {
  const host = String(cookie.domain || '').replace(/^\./, '')
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`
}

/**
 * Build the details object for `session.cookies.set`, honouring __Host-/__Secure- rules.
 * @param {object} cookie
 * @param {number} expirationDate Epoch seconds.
 * @returns {object}
 */
function buildRenewal(cookie, expirationDate) {
  const details = {
    url: buildCookieUrl(cookie), name: cookie.name, value: cookie.value, path: cookie.path || '/',
    secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly), expirationDate,
  }
  if (cookie.sameSite && cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite
  if (!cookie.hostOnly && !cookie.name.startsWith('__Host-')) details.domain = cookie.domain
  if (cookie.name.startsWith('__Host-')) { details.secure = true; details.path = '/' }
  if (cookie.name.startsWith('__Secure-')) details.secure = true
  return details
}

/**
 * Watch one session; returns a detach function.
 * @param {object} electronSession Electron Session (cookies API).
 * @param {{ getTtlDays: () => number, now?: () => number, setInterval?: typeof setInterval,
 *   clearInterval?: typeof clearInterval, logger?: object }} deps
 * @returns {{ detach: () => void, scan: () => Promise<number>, flush: () => Promise<void> }}
 */
function attachCookiePersister(electronSession, deps) {
  const now = deps.now || Date.now
  const recent = new Map()

  async function renew(cookie) {
    const ttl = deps.getTtlDays()
    if (!(ttl > 0) || cookie.session !== true || cookie.expirationDate) return false
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`
    const last = recent.get(key)
    if (last && now() - last < DEDUPE_WINDOW_MS) return false
    recent.set(key, now())
    if (recent.size > 2000) recent.clear()
    try {
      await electronSession.cookies.set(buildRenewal(cookie, Math.floor(now() / 1000) + ttl * DAY_S))
      return true
    } catch (err) {
      if (deps.logger) deps.logger.debug('browser', `cookie renew failed (${cookie.name}): ${err.message}`)
      return false
    }
  }

  const onChanged = (_event, cookie, cause, removed) => {
    if (removed || cause !== 'explicit') return
    renew(cookie).catch(() => {})
  }
  electronSession.cookies.on('changed', onChanged)

  const flush = async () => {
    try { await electronSession.cookies.flushStore() } catch { /* store may already be closed */ }
  }
  const setIv = deps.setInterval || setInterval
  const timer = setIv(flush, FLUSH_INTERVAL_MS)
  if (timer && timer.unref) timer.unref()

  /** Startup compensation: renew every session cookie already present. */
  async function scan() {
    let renewed = 0
    for (const cookie of await electronSession.cookies.get({})) {
      if (await renew(cookie)) renewed += 1
    }
    return renewed
  }

  return {
    scan,
    flush,
    detach() {
      electronSession.cookies.removeListener('changed', onChanged)
      ;(deps.clearInterval || clearInterval)(timer)
    },
  }
}

module.exports = { attachCookiePersister, buildRenewal, buildCookieUrl }
