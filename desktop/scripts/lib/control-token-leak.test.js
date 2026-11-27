'use strict'

/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */

// Regression pin for smoke check ① (spec agent-browser-workspace §8.3).
//
// The case that matters is `a healthy /capabilities body is not a leak`: the first
// version of the gate grepped the serialised body for `/token|BROWSER_WORKSPACE/i`
// and failed a packaged build whose only sin was echoing
// `limits.context_window_tokens: 128000`. The fixture below is the REAL body shape
// captured from `desktop/release/win-unpacked` on 2026-11-26 (every key, real
// values), so the regression cannot come back unnoticed.
//
// The remaining cases prove the predicate still fails on the three shapes a real
// leak can take — a loosened gate is worse than no gate.

const assert = require('assert')

const { findControlTokenLeak, describeLeak } = require('./control-token-leak')

/** The real packaged response (trimmed to the keys that exist), proven clean. */
function healthyCapabilities() {
  return {
    success: true,
    message: 'ok',
    data: {
      search: { available: false, enabled: true, configured: false, key_count: 0,
        error_code: 'provider_not_configured' },
      browser: { available: false, error_code: 'browser_unavailable', enabled: true },
      downloads: { available: true, enabled: true, error_code: null },
      research_model: { available: true, enabled: false },
      proxy: { mode: 'auto', resolved_from: 'direct', target: '' },
      workspace_browser: {
        available: false, enabled: true, agent_enabled: true, consent_granted: false,
        profile: null, mode: 'isolated', error_code: 'workspace_unavailable',
      },
      egress: { mode: 'balanced', tier1: true, tier2: true,
        proxy: { mode: 'auto', resolved_from: 'direct', target: '' } },
      limits: {
        enabled: true, browser_enabled: true, downloads_enabled: true,
        respect_robots: true, use_research_model: false,
        // The two keys the naive /token/i scan tripped over. They are LLM context
        // budgets (numbers), NOT credentials — this pair is the whole regression.
        context_window_tokens: 128000,
        research_context_window_tokens: 32768,
        global_concurrency: 3, max_sources: 4, proxy_mode: 'auto',
        custom_proxy_url: '', artifact_retention_days: 7,
      },
    },
  }
}

/** A live-looking control token: 32 random bytes as hex, exactly as generated. */
const TOKEN = 'a1b2c3d4'.repeat(8)

const CASES = []

CASES.push(['a healthy /capabilities body is not a leak', () => {
  const findings = findControlTokenLeak(healthyCapabilities())
  assert.deepStrictEqual(findings, [],
    `a healthy body must be clean, got: ${describeLeak(findings)}`)
}])

CASES.push(['the raw token under a workspace_browser key is a leak', () => {
  const body = healthyCapabilities()
  body.data.workspace_browser.token = TOKEN
  const findings = findControlTokenLeak(body)
  assert.strictEqual(findings.length, 1)
  assert.strictEqual(findings[0].path, 'data.workspace_browser.token')
}])

CASES.push(['the token shape is caught even under an innocent key name', () => {
  const body = healthyCapabilities()
  body.data.proxy.target = `http://127.0.0.1:1/?t=${TOKEN}`
  const findings = findControlTokenLeak(body)
  assert.strictEqual(findings.length, 1)
  assert.ok(findings[0].reason.includes('token shape'), findings[0].reason)
}])

CASES.push(['the env var name is a leak wherever it appears', () => {
  const body = healthyCapabilities()
  body.data.egress.detail = 'BROWSER_WORKSPACE_CONTROL_TOKEN is set'
  const findings = findControlTokenLeak(body)
  assert.strictEqual(findings.length, 1)
  assert.ok(findings[0].reason.includes('env name'), findings[0].reason)
}])

CASES.push(['a secret-shaped key holding a short string is NOT a leak', () => {
  // `keyHint` is the documented non-secret surface (last 4 chars). A gate that
  // reds on it would forbid the one field the UI legitimately shows.
  const body = healthyCapabilities()
  body.data.workspace_browser.keyHint = 'a1b2'
  assert.deepStrictEqual(findControlTokenLeak(body), [])
}])

CASES.push(['findings never carry the offending value', () => {
  const body = healthyCapabilities()
  body.data.workspace_browser.token = TOKEN
  const described = describeLeak(findControlTokenLeak(body))
  assert.ok(described.length > 0)
  assert.ok(!described.includes(TOKEN), 'the report must not republish the secret')
}])

CASES.push(['a non-string body does not throw', () => {
  for (const value of [null, undefined, 0, 'text', [], {}]) {
    assert.deepStrictEqual(findControlTokenLeak(value), [])
  }
}])

async function run() {
  for (const [name, fn] of CASES) {
    await fn()
    console.log(`  ok - ${name}`)
  }
  console.log(`control-token-leak tests passed (${CASES.length})`)
  return CASES.length
}

module.exports = { run }

if (require.main === module) {
  run().catch((error) => {
    console.error(`control-token-leak tests FAILED: ${(error && error.stack) || error}`)
    process.exit(1)
  })
}
