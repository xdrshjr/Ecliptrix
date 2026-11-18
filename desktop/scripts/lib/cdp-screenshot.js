/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const fs = require('fs')
const path = require('path')

// Screenshot evidence for the packaged gate, build 2026-11-17 20:38 (and the
// earlier final-gate-36 / ecliptrix-smoke-XxoWoG runs): the gate printed
//
//   [smoke-test] screenshot surface {"visibility":"hidden","focus":true,...}
//   [smoke-test] FAIL: Error: CDP timeout: Page.captureScreenshot
//
// i.e. `document.visibilityState` was "hidden" while `document.hasFocus()` was
// still true, and the very next `Page.captureScreenshot` never answered inside
// the 30s CDP deadline. A window that Windows reports as occluded (covered,
// off-screen, session locked, or never composited after a display change) stops
// Chromium's frame production, so the surface the screenshot is read from has
// no frame to hand back. That is a property of the machine the gate runs on, not
// of the app: the same build passed with "visibility":"visible" on 37 earlier
// runs, and every measured assertion (canvas size, fonts, text ranges) in the
// same block passed before the capture was attempted.
//
// So the screenshots become recoverable evidence instead of an unconditional
// kill switch, but only in the narrow case where the renderer is provably alive:
//
//   * attempt 1 — plain surface capture (30s, unchanged from before);
//   * attempt 2 — put the page back in the active lifecycle, emulate focus,
//     re-arm the device metrics and capture from the renderer (20s);
//   * probe     — ask the renderer to evaluate. No answer => the renderer
//     itself is gone, which is exactly what the gate exists to catch, so the
//     error is re-thrown and the run still fails;
//   * otherwise => `status: 'degraded'`: the PNG is missing, the caller records
//     why in its report and prints a warning, and the functional assertions
//     that ran around it keep their verdict.
//
// Both directions are pinned by smoke-test.screenshot-evidence.test.js.

const FIRST_ATTEMPT_TIMEOUT_MS = 30 * 1000
const RECOVERY_ATTEMPT_TIMEOUT_MS = 20 * 1000
const PROBE_TIMEOUT_MS = 5 * 1000
const NUDGE_TIMEOUT_MS = 10 * 1000

function message (error) {
  return String((error && error.message) || error).slice(0, 240)
}

// The probe reads visibility in the same round trip, so the degraded note can
// say why no frame was produced instead of guessing.
async function probeRenderer (cdp, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ visibility: document.visibilityState, alive: 1 + 1 === 2 })',
      returnByValue: true,
    }, timeoutMs)
    const raw = result && result.result && result.result.value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : null
    if (!parsed) return { alive: false, visibility: null, error: 'unreadable probe result' }
    return { alive: parsed.alive === true, visibility: parsed.visibility || null }
  } catch (error) {
    return { alive: false, visibility: null, error: message(error) }
  }
}

// Each nudge is best effort: a command that the renderer cannot answer is
// itself part of the evidence, so it is recorded and the ladder continues.
async function recoverCompositor (cdp, { metrics, timeoutMs = NUDGE_TIMEOUT_MS } = {}) {
  const steps = []
  const nudge = async (label, run) => {
    try {
      await run()
      steps.push(`${label}=ok`)
    } catch (error) {
      steps.push(`${label}=${message(error)}`)
    }
  }
  await nudge('lifecycle', () =>
    cdp.send('Page.setWebLifecycleState', { state: 'active' }, timeoutMs))
  await nudge('focus', () =>
    cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, timeoutMs))
  if (metrics) {
    await nudge('metrics', () =>
      cdp.send('Emulation.setDeviceMetricsOverride', metrics, timeoutMs))
  }
  return steps
}

async function captureEvidence (cdp, {
  directory,
  fileName,
  metrics,
  label = fileName,
  firstTimeoutMs = FIRST_ATTEMPT_TIMEOUT_MS,
  recoveryTimeoutMs = RECOVERY_ATTEMPT_TIMEOUT_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  if (!directory || !fileName) {
    throw new Error('captureEvidence needs a directory and a file name')
  }
  const target = path.join(directory, fileName)
  const attempts = []

  const capture = async (name, params, timeoutMs) => {
    const result = await cdp.send('Page.captureScreenshot', params, timeoutMs)
    if (!result || typeof result.data !== 'string' || !result.data) {
      throw new Error('empty screenshot payload')
    }
    fs.writeFileSync(target, Buffer.from(result.data, 'base64'))
    attempts.push({ name, status: 'captured', timeoutMs })
  }

  try {
    await capture('surface', { format: 'png' }, firstTimeoutMs)
    return { status: 'captured', file: target, label, attempts }
  } catch (error) {
    attempts.push({ name: 'surface', status: 'failed', timeoutMs: firstTimeoutMs, error: message(error) })
  }

  const nudges = await recoverCompositor(cdp, { metrics })
  try {
    await capture('renderer', { format: 'png', fromSurface: false,
      captureBeyondViewport: true }, recoveryTimeoutMs)
    return { status: 'captured', file: target, label, attempts, nudges }
  } catch (error) {
    attempts.push({ name: 'renderer', status: 'failed', timeoutMs: recoveryTimeoutMs, error: message(error) })
  }

  const probe = await probeRenderer(cdp, probeTimeoutMs)
  const details = attempts.map(attempt =>
    `${attempt.name}(${attempt.timeoutMs}ms): ${attempt.error}`).join('; ')
  if (!probe.alive) {
    throw new Error(`screenshot evidence "${label}" failed and the renderer is ` +
      `unresponsive (${details}; nudges ${nudges.join(', ')}` +
      `${probe.error ? `; probe: ${probe.error}` : ''})`)
  }
  return {
    status: 'degraded',
    file: null,
    label,
    attempts,
    nudges,
    visibility: probe.visibility,
    reason: `renderer alive (visibility=${probe.visibility}) but produced no frame ` +
      `within ${firstTimeoutMs + recoveryTimeoutMs}ms: ${details}`,
  }
}

module.exports = {
  FIRST_ATTEMPT_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  RECOVERY_ATTEMPT_TIMEOUT_MS,
  captureEvidence,
  probeRenderer,
  recoverCompositor,
}
