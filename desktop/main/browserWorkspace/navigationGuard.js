'use strict'

// navigationGuard.js — pure URL / host classification (spec §4.2.6, §6.5).
//
// Why a second implementation next to Python's egress_policy: redirects and
// sub-resources can only be judged synchronously in the main process. This file
// is the *executing mirror* of the same rules; the shared vector file
// (__fixtures__/url-guard-vectors.json) is consumed by both sides so they cannot
// drift apart (R2-1). Backend-initiated requests still decide in egress_policy.

const MAX_URL_LENGTH = 4096
const OWN_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'])

/** Built-in sensitive host suffixes (agent navigation only, spec §6.5). */
const SENSITIVE_HOST_SUFFIXES = [
  'alipay.com', 'pay.weixin.qq.com', 'pay.qq.com', 'tenpay.com', 'unionpay.com',
  'paypal.com', 'stripe.com', 'wise.com', 'venmo.com', 'cash.app',
  'binance.com', 'okx.com',
]
const SENSITIVE_PATHS = ['/security', '/account/security', '/settings/password', '/passkeys']

/**
 * @param {string} host Hostname without port; IPv6 may be bracketed.
 * @returns {string}
 */
function stripBrackets(host) {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/**
 * Parse dotted-quad IPv4.
 * @param {string} text
 * @returns {number[]|null}
 */
function parseIPv4(text) {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN))
  return octets.every((n) => n >= 0 && n <= 255) ? octets : null
}

/**
 * Parse an IPv6 literal into eight 16-bit words (supports `::` and embedded v4).
 * @param {string} text
 * @returns {number[]|null}
 */
function parseIPv6(text) {
  let source = text
  const lastColon = source.lastIndexOf(':')
  const tail = source.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail)
    if (!v4) return null
    const hi = ((v4[0] << 8) | v4[1]).toString(16)
    const lo = ((v4[2] << 8) | v4[3]).toString(16)
    source = `${source.slice(0, lastColon + 1)}${hi}:${lo}`
  }
  const halves = source.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - rest.length
  if ((halves.length === 1 && head.length !== 8) || fill < 0) return null
  const zeros = Array(halves.length === 2 ? fill : 0).fill('0')
  const parsed = [...head, ...zeros, ...rest].map((w) =>
    /^[0-9a-fA-F]{1,4}$/.test(w) ? parseInt(w, 16) : NaN)
  return parsed.length === 8 && parsed.every((n) => !Number.isNaN(n)) ? parsed : null
}

/** @param {number[]} o IPv4 octets. @returns {boolean} */
function isPrivateV4(o) {
  const [a, b] = o
  return a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
}

/**
 * Is this literal IP private / loopback / link-local / CGNAT / ULA?
 * @param {string} ip IPv4 or IPv6 literal (brackets tolerated).
 * @returns {boolean} false for non-IP strings.
 */
function isPrivateAddress(ip) {
  const text = stripBrackets(String(ip))
  const v4 = parseIPv4(text)
  if (v4) return isPrivateV4(v4)
  const w = parseIPv6(text)
  if (!w) return false
  if (w.slice(0, 7).every((x) => x === 0)) return true // ::1 and ::
  if ((w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80) return true
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) {
    return isPrivateV4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255])
  }
  return false
}

/** @param {string} host @returns {boolean} */
function isLiteralIp(host) {
  const text = stripBrackets(host)
  return Boolean(parseIPv4(text) || parseIPv6(text))
}

/**
 * Suffix match on a host list ("example.com" matches "a.example.com").
 * @param {string} host
 * @param {string[]} suffixes
 * @returns {boolean}
 */
function matchesHostSuffix(host, suffixes) {
  const h = host.toLowerCase().replace(/\.$/, '')
  return suffixes.some((s) => {
    const suffix = String(s).toLowerCase().replace(/^\./, '')
    return suffix && (h === suffix || h.endsWith(`.${suffix}`))
  })
}

/** @param {string} pathname @returns {boolean} */
function isSensitivePath(pathname) {
  const p = pathname.toLowerCase().replace(/\/+$/, '')
  return SENSITIVE_PATHS.some((s) => p === s || p.startsWith(`${s}/`))
}

/**
 * Effective port of a URL (explicit or scheme default).
 * @param {URL} url
 * @returns {number}
 */
function effectivePort(url) {
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80
}

const blocked = (code, sticky = false) => ({ ok: false, code, sticky })

/**
 * Decide whether `raw` may be navigated to.
 *
 * @param {string} raw Candidate URL.
 * @param {{ actor: 'user'|'agent', allowPrivate?: boolean, ownPorts?: Iterable<number>,
 *   denyHosts?: string[] }} options Rules context (ports the app itself listens on, etc.).
 * @returns {{ ok: true, url: string } | { ok: false, code: string, sticky: boolean }}
 */
function checkUrl(raw, options) {
  const { actor, allowPrivate = false, denyHosts = [] } = options
  const ownPorts = new Set(options.ownPorts || [])
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return blocked('navigation_blocked')
  let url
  try {
    url = new URL(raw)
  } catch {
    return blocked('navigation_blocked')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return blocked('navigation_blocked')
  if (url.username || url.password) return blocked('navigation_blocked')
  if (OWN_HOSTS.has(url.hostname.toLowerCase()) && ownPorts.has(effectivePort(url))) {
    return blocked('navigation_blocked')
  }
  if (actor === 'agent') {
    const host = url.hostname.toLowerCase()
    const privateHost = host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)
    if (privateHost && !allowPrivate) return blocked('private_network_blocked')
    if (matchesHostSuffix(host, [...SENSITIVE_HOST_SUFFIXES, ...denyHosts]) || isSensitivePath(url.pathname)) {
      return blocked('sensitive_site_blocked', true)
    }
  }
  return { ok: true, url: url.href }
}

/**
 * Main-process judgement for DNS answers of an agent navigation (R-5).
 * @param {string[]} addresses Resolved addresses.
 * @param {boolean} allowPrivate
 * @returns {boolean} true when the host may be reached.
 */
function dnsAnswersAllowed(addresses, allowPrivate) {
  return allowPrivate || !addresses.some((a) => isPrivateAddress(a))
}

module.exports = {
  checkUrl, isPrivateAddress, isLiteralIp, matchesHostSuffix, isSensitivePath, dnsAnswersAllowed,
  stripBrackets, MAX_URL_LENGTH, SENSITIVE_HOST_SUFFIXES,
}
