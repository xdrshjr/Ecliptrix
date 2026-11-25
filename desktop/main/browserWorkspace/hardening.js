'use strict'

// hardening.js — per-session lockdown for every workspace partition (spec §4.2.7).
//
// R2-4: Electron allows exactly ONE listener per webRequest event per session, a later
// registration silently replaces the earlier one. So each session gets one
// onBeforeRequest and one onBeforeSendHeaders here, composing every duty in order
// (ban → DNS check → rest / UA hints). Nothing else may call `webRequest.on*` on a
// workspace session. D-BW2-9: requests that hit this app's own ports are cancelled —
// the local backend has no auth, so a hostile page must never reach it.

const dns = require('dns')
const { checkUrl, dnsAnswersAllowed, isLiteralIp } = require('./navigationGuard')

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'])
const OWN_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'])
const DNS_TIMEOUT_MS = 1500
const DNS_CACHE_MS = 30_000

/** @param {string} chromeVersion e.g. "130.0.6723.191" @returns {string} Standard Chrome UA. */
function buildChromeUserAgent(chromeVersion, platform = process.platform) {
  const os = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64'
  const major = String(chromeVersion).split('.')[0]
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/** @param {string} chromeVersion @returns {string} sec-ch-ua brand list. */
function buildSecChUa(chromeVersion) {
  const major = String(chromeVersion).split('.')[0]
  return `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not.A/Brand";v="99"`
}

/**
 * @param {object} deps
 * @param {() => Iterable<number>} deps.getOwnPorts Backend/frontend/control… ports.
 * @param {() => object} deps.getSettings browser_workspace settings (preferences).
 * @param {(webContentsId: number) => boolean} deps.isAgentWebContents
 * @param {() => string|null} [deps.getProxyRules] Same proxy rule the research browser uses.
 * @param {(host: string, opts: object) => Promise<{address: string}[]>} [deps.dnsLookup]
 * @param {(info: object) => void} [deps.onBlocked] Activity hook (never carries query strings).
 * @param {string} [deps.chromeVersion]
 * @param {string} [deps.locale]
 * @param {() => number} [deps.now]
 */
function createHardening(deps) {
  const installed = new WeakSet()
  const lookup = deps.dnsLookup || ((host, opts) => dns.promises.lookup(host, opts))
  const now = deps.now || Date.now
  const dnsCache = new Map()
  const chromeVersion = deps.chromeVersion || process.versions.chrome || '130.0.0.0'

  function ownPortsSet() { return new Set(deps.getOwnPorts()) }

  function hitsOwnPort(url) {
    if (!OWN_HOSTS.has(url.hostname.toLowerCase())) return false
    const port = url.port ? Number(url.port) : (url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80)
    return ownPortsSet().has(port)
  }

  /** @returns {Promise<boolean>} true = host resolves only to allowed addresses. */
  async function dnsAllowed(host, allowPrivate) {
    const hit = dnsCache.get(host)
    if (hit && now() - hit.at < DNS_CACHE_MS) return dnsAnswersAllowed(hit.addresses, allowPrivate)
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('dns_timeout')), DNS_TIMEOUT_MS).unref())
      const answers = await Promise.race([lookup(host, { all: true }), timeout])
      const addresses = answers.map((a) => a.address)
      dnsCache.set(host, { at: now(), addresses })
      return dnsAnswersAllowed(addresses, allowPrivate)
    } catch {
      // Behind a proxy the PROXY resolves names, so a local failure proves nothing (R2-4).
      return Boolean(deps.getProxyRules && deps.getProxyRules())
    }
  }

  /**
   * The one onBeforeRequest policy. Exposed for tests: resolves to `{ cancel, reason }`.
   * @param {{ url: string, resourceType?: string, webContentsId?: number }} details
   */
  async function decideRequest(details) {
    let url
    try { url = new URL(details.url) } catch { return { cancel: true, reason: 'navigation_blocked' } }
    if (!ALLOWED_SCHEMES.has(url.protocol)) return { cancel: true, reason: 'navigation_blocked' }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return { cancel: false }
    if (hitsOwnPort(url)) return { cancel: true, reason: 'own_port_blocked' }
    const isAgentNav = details.resourceType === 'mainFrame' && deps.isAgentWebContents(details.webContentsId)
    if (!isAgentNav || (url.protocol !== 'http:' && url.protocol !== 'https:')) return { cancel: false }
    const settings = deps.getSettings()
    const allowPrivate = Boolean(settings.agent_allow_private_network)
    const verdict = checkUrl(details.url, {
      actor: 'agent', allowPrivate, ownPorts: ownPortsSet(), denyHosts: settings.agent_deny_hosts || [],
    })
    if (!verdict.ok) return { cancel: true, reason: verdict.code }
    if (!isLiteralIp(url.hostname) && !allowPrivate && !(await dnsAllowed(url.hostname, allowPrivate))) {
      return { cancel: true, reason: 'private_network_blocked' }
    }
    return { cancel: false }
  }

  /**
   * Install (idempotently) every duty on one Session.
   * @param {object} session Electron Session.
   * @param {{ acceptLanguages?: string }} [options]
   */
  function install(session, options = {}) {
    if (installed.has(session)) return
    installed.add(session)
    session.webRequest.onBeforeRequest((details, callback) => {
      decideRequest(details).then((verdict) => {
        if (verdict.cancel && deps.onBlocked) deps.onBlocked({ reason: verdict.reason, host: safeHost(details.url) })
        callback({ cancel: verdict.cancel })
      }, () => callback({ cancel: true }))
    })
    const secChUa = buildSecChUa(chromeVersion)
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'sec-ch-ua') headers[key] = secChUa
      }
      callback({ requestHeaders: headers })
    })
    const allowPermission = (permission) => permission === 'clipboard-sanitized-write'
    session.setPermissionRequestHandler((_wc, permission, callback) => callback(allowPermission(permission)))
    session.setPermissionCheckHandler((_wc, permission) => allowPermission(permission))
    session.on('will-download', (event) => {
      event.preventDefault()
      if (deps.onBlocked) deps.onBlocked({ reason: 'download_blocked' })
    })
    session.setUserAgent(buildChromeUserAgent(chromeVersion), options.acceptLanguages || deps.locale || 'zh-CN,zh,en')
    const rules = deps.getProxyRules ? deps.getProxyRules() : null
    Promise.resolve(session.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })).catch(() => {})
    try {
      session.setSpellCheckerEnabled(true)
      if (deps.locale) session.setSpellCheckerLanguages([deps.locale])
    } catch { /* unsupported locale / platform: spell check is cosmetic */ }
  }

  return { install, decideRequest }
}

function safeHost(raw) {
  try { return new URL(raw).hostname } catch { return '' }
}

module.exports = { createHardening, buildChromeUserAgent, buildSecChUa, ALLOWED_SCHEMES }
