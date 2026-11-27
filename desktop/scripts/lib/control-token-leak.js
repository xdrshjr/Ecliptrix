'use strict'

/**
 * Predicate behind smoke check ①: does a `/api/web-research/capabilities`
 * payload carry the Agent browser workspace control token?
 *
 * Why this module exists — read before "simplifying" it back to one regex.
 *
 * The first version of the check scanned the serialised whole body for
 * `/token|BROWSER_WORKSPACE/i`. That reddened a HEALTHY package, because
 * `/capabilities` legitimately returns `limits.context_window_tokens` (128000)
 * and `limits.research_context_window_tokens` (32768) — LLM context budgets that
 * merely share a word with the secret. The payload is proven clean by
 * `test_browser_token_never_leaks.py` on the backend side, so a gate that fails
 * on a healthy build is wrong, and a security gate nobody can keep green gets
 * deleted by the next person in a hurry.
 *
 * The real invariant (CLAUDE.md, agent-browser-workspace invariant 2) is narrow:
 * the per-launch secret never leaves the main process. That secret is
 * `crypto.randomBytes(32).toString('hex')` (desktop/main/browserWorkspace/
 * index.js), handed to the backend only as the `BROWSER_WORKSPACE_CONTROL_TOKEN`
 * env var. So a leak has exactly three decidable shapes, and the gate matches
 * those instead of a word:
 *
 *   1. the env var NAME (`BROWSER_WORKSPACE_CONTROL…`) appears at all;
 *   2. the token's VALUE SHAPE — 32+ hex characters — appears under any key;
 *   3. a promise-shaped key (`…token`, `…secret`, `…credential`, `…password`)
 *      holding a string long enough to be a secret.
 *
 * Rule 3 deliberately requires a STRING value: numeric budget keys such as
 * `context_window_tokens` are configuration, never credentials. That is the
 * whole difference between this predicate and the regex it replaces.
 *
 * Pure by design — no fs, no network, no process.env — so the cases can be
 * pinned in `control-token-leak.test.js` with hand-written fixtures.
 */

/** The env var the backend receives. Its appearance anywhere is a leak. */
const CONTROL_ENV_NAME = /BROWSER_WORKSPACE_CONTROL/

/** `crypto.randomBytes(32).toString('hex')`, the only shape the token has. */
const CONTROL_VALUE_SHAPE = /\b[0-9a-f]{32,}\b/i

/** Key names that promise a credential. */
const SUSPECT_KEY_NAME = /(token|secret|credential|password)/i

/** Shorter values cannot be the 64-char token; this is the floor rule 3 uses. */
const MIN_SECRET_STRING = 16

/** Walk every string leaf, yielding `{ path, key, value }`. */
function* walk(value, path = '', key = '') {
  if (typeof value === 'string') {
    yield { path, key, value }
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      yield* walk(value[index], `${path}[${index}]`, key)
    }
    return
  }
  if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) {
      yield* walk(child, path ? `${path}.${childKey}` : childKey, childKey)
    }
  }
}

/**
 * Find every way a capabilities payload could carry the control token.
 *
 * Returns PATHS and REASONS only — never the offending value — so a failure can
 * be logged, pasted into a ticket or attached to release evidence without
 * republishing the secret it is complaining about.
 *
 * @param {unknown} body Parsed JSON body (or any JSON-ish value).
 * @returns {{path: string, reason: string}[]} One entry per finding; empty when clean.
 */
function findControlTokenLeak(body) {
  const findings = []
  for (const { path, key, value } of walk(body)) {
    if (CONTROL_ENV_NAME.test(value) || CONTROL_ENV_NAME.test(key)) {
      findings.push({ path: path || '(root)', reason: 'control-token env name' })
      continue
    }
    if (CONTROL_VALUE_SHAPE.test(value)) {
      findings.push({ path: path || '(root)', reason: '32+ hex characters (token shape)' })
      continue
    }
    if (value.length >= MIN_SECRET_STRING && SUSPECT_KEY_NAME.test(key)) {
      findings.push({ path: path || '(root)', reason: 'secret-shaped key holding a string' })
    }
  }
  return findings
}

/**
 * Human-readable one-liner for a `fail()` call.
 *
 * @param {{path: string, reason: string}[]} findings Output of findControlTokenLeak.
 * @returns {string} Empty string when there is nothing to report.
 */
function describeLeak(findings) {
  if (!findings.length) return ''
  return findings.slice(0, 3).map((f) => `${f.path} → ${f.reason}`).join('; ')
}

module.exports = { findControlTokenLeak, describeLeak }
