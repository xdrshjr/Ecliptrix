'use strict'

// Deadline for Chromium's system-proxy probe. `session.defaultSession
// .resolveProxy` is a call into Chromium whose callback can never fire in the
// packaged app — measured silent after 154s, and with `--no-proxy-server` as
// well, so it is the API/environment and not the user's proxy — while startup
// awaited it without any deadline, so `startServices()` never ran and the
// packaged app hung before spawning anything
// (docs/diagnoses/desktop-build-agent-browser-host-missing-payload).
//
// 2.5s is the chosen bound: a healthy probe answers in milliseconds (a PAC
// script download is the slow case) so a real user never notices it behind the
// splash screen, yet it caps a stall three orders of magnitude below the 154s
// incident. Raise it only with a measurement of a probe that legitimately needs
// longer — the probe is an optimisation for proxied users, never a startup
// dependency, so "no answer" must degrade to DIRECT quickly.
const DEFAULT_TIMEOUT_MS = 2500

// Any https target yields the same rules; this is the URL the probe used before
// it was extracted, kept so the observed behaviour does not change.
const DEFAULT_PROBE_URL = 'https://example.com'

// Sentinel that distinguishes "the resolver said nothing" from "the resolver
// answered" — the answer itself may legitimately be a string we do not parse.
const TIMED_OUT = Symbol('proxyProbeTimedOut')

// Chromium's rule grammar: first `PROXY host:port` hop wins. DIRECT, SOCKS-only
// and empty answers all fall through to null (= dial directly).
const PROXY_RULE_PATTERN = /PROXY\s+([^\s;]+)/

/**
 * Warn that the resolver missed its deadline. Same `[process]` shape as the
 * other proxy diagnostics so `error.log` filters still find it.
 *
 * @param {{ warn?: Function }|null} logger Injection point; null in tests.
 * @param {number} timeoutMs The deadline that elapsed.
 * @returns {void}
 */
function logProbeTimeout(logger, timeoutMs) {
  if (!logger || typeof logger.warn !== 'function') return
  logger.warn(
    'process',
    `resolveProxy did not answer within ${timeoutMs}ms — ` +
      'continuing without a system proxy',
  )
}

/**
 * Turn a raw resolveProxy answer into one proxy URL.
 *
 * Non-strings are treated as "no proxy": the resolver is an external boundary,
 * so an unexpected payload (an error object, undefined) must degrade instead of
 * throwing inside startup.
 *
 * @param {unknown} proxyRules Raw resolveProxy answer, e.g. 'PROXY 1.2.3.4:80'.
 * @returns {string|null} `scheme://host:port` (scheme defaulted to http), or
 *   null when the rules name no HTTP proxy.
 */
function parseProxyRules(proxyRules) {
  if (typeof proxyRules !== 'string') return null
  const match = PROXY_RULE_PATTERN.exec(proxyRules)
  if (!match) return null
  return match[1].includes('://') ? match[1] : `http://${match[1]}`
}

/**
 * Call the callback-style resolver exactly once.
 *
 * A synchronous throw inside the executor rejects the returned promise, which
 * is what propagates the error to the caller instead of hiding it.
 *
 * @param {Function} resolveProxy Injected resolver, called as
 *   `(probeUrl, callback)`; `session.defaultSession.resolveProxy` in the app.
 * @returns {Promise<string>} The rules string handed to the callback.
 */
function askResolveProxy(resolveProxy) {
  return new Promise((resolve) => {
    resolveProxy(DEFAULT_PROBE_URL, (proxyRules) => resolve(proxyRules))
  })
}

/**
 * Arm a timer that settles the probe as "no answer" and clears itself.
 *
 * @param {number} timeoutMs Deadline in milliseconds.
 * @param {{ warn?: Function }|null} logger Warning sink.
 * @returns {{ promise: Promise<symbol>, clear: () => void }} The deadline and
 *   its cancellation, so a fast answer does not keep a timer alive.
 */
function createDeadline(timeoutMs, logger) {
  let timeoutId = null
  const promise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      logProbeTimeout(logger, timeoutMs)
      resolve(TIMED_OUT)
    }, timeoutMs)
  })
  return { promise, clear: () => clearTimeout(timeoutId) }
}

/**
 * Await the resolver's answer, but never longer than timeoutMs.
 *
 * `Promise.race` also subscribes to the resolver promise, so a resolver that
 * throws (sync or async) surfaces as a rejection here and is never reported as
 * an unhandled rejection, even when the deadline wins the race.
 *
 * @param {object} options Probe options.
 * @param {Function} options.resolveProxy Injected resolver.
 * @param {number} options.timeoutMs Deadline in milliseconds.
 * @param {{ warn?: Function }|null} options.logger Warning sink.
 * @returns {Promise<string|null>} The rules string, or null on timeout.
 * @throws {Error} Whatever `resolveProxy` threw — genuine errors are the
 *   caller's business; only a callback that never fires is handled here.
 */
async function requestProxyRules({ resolveProxy, timeoutMs, logger }) {
  const deadline = createDeadline(timeoutMs, logger)
  try {
    const proxyRules = await Promise.race([
      askResolveProxy(resolveProxy),
      deadline.promise,
    ])
    return proxyRules === TIMED_OUT ? null : proxyRules
  } finally {
    deadline.clear()
  }
}

/**
 * Best-effort probe of the OS system proxy, bounded by a deadline.
 *
 * On timeout it logs one warning and returns null (direct connection) so the
 * caller can carry on; it never rejects for a resolver that simply never calls
 * back, and it never retries.
 *
 * @param {object} options Probe options.
 * @param {(probeUrl: string, callback: (rules: string) => void) => void}
 *   options.resolveProxy Injected resolver — `session.defaultSession
 *   .resolveProxy` in the app, a fake in tests (no Electron needed).
 * @param {number} [options.timeoutMs=DEFAULT_TIMEOUT_MS] Deadline in ms.
 * @param {{ warn?: Function }|null} [options.logger=null] Warning sink.
 * @returns {Promise<string|null>} Proxy URL (`http://host:port`), or null when
 *   there is no HTTP proxy, the answer is unparseable, or the deadline elapsed.
 * @throws {TypeError} When `resolveProxy` is not a function.
 * @throws {Error} When `resolveProxy` itself throws — propagated, never
 *   swallowed.
 */
async function probeSystemProxy({
  resolveProxy,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = null,
}) {
  if (typeof resolveProxy !== 'function') {
    throw new TypeError(
      'probeSystemProxy: resolveProxy must be a function ' +
        '(session.defaultSession.resolveProxy)',
    )
  }
  const proxyRules = await requestProxyRules({
    resolveProxy,
    timeoutMs,
    logger,
  })
  return parseProxyRules(proxyRules)
}

module.exports = { DEFAULT_TIMEOUT_MS, parseProxyRules, probeSystemProxy }
