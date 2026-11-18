/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  FIRST_ATTEMPT_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  RECOVERY_ATTEMPT_TIMEOUT_MS,
  captureEvidence,
} = require('./lib/cdp-screenshot')

// Regression, build 2026-11-17 20:38 and final-gate-36 / ecliptrix-smoke-XxoWoG:
// `Page.captureScreenshot` never answered, the 30s CDP deadline fired and the
// whole release gate went red on a run whose functional assertions had all
// passed. The surface was `document.visibilityState === 'hidden'` — an occluded
// window produces no frame — while `document.hasFocus()` was still true, which is
// why the run looked like a hung app.
//
// The four cases below pin the contract in both directions: a frame that needs
// one recovery attempt MUST still be captured, a hidden-but-live renderer MUST
// degrade with a recorded reason instead of killing the gate, and a renderer
// that stopped answering MUST still fail the run.

function workspace () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecliptrix-shot-'))
}

function png (text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

// Minimal CDP stand-in: records every (method, params, timeout) triple and
// answers from a per-method queue of handlers.
function fakeCdp (handlers) {
  const calls = []
  return {
    calls,
    async send (method, params, timeoutMs) {
      calls.push({ method, params, timeoutMs })
      const handler = handlers[method]
      if (!handler) throw new Error(`not stubbed: ${method}`)
      const queue = Array.isArray(handler) ? handler : [handler]
      const index = calls.filter(call => call.method === method).length - 1
      const step = queue[Math.min(index, queue.length - 1)]
      return step(params, timeoutMs)
    },
  }
}

test('captures on the first attempt with the suite deadline', async () => {
  const directory = workspace()
  const cdp = fakeCdp({
    'Page.captureScreenshot': () => ({ data: png('first-frame') }),
  })

  const result = await captureEvidence(cdp, { directory, fileName: 'shot.png' })

  assert.strictEqual(result.status, 'captured')
  assert.strictEqual(result.file, path.join(directory, 'shot.png'))
  assert.deepStrictEqual(fs.readFileSync(result.file), Buffer.from('first-frame'))
  assert.strictEqual(cdp.calls.length, 1)
  assert.deepStrictEqual(cdp.calls[0].params, { format: 'png' })
  assert.strictEqual(cdp.calls[0].timeoutMs, FIRST_ATTEMPT_TIMEOUT_MS)
  assert.strictEqual(result.attempts.length, 1)
  assert.strictEqual(result.nudges, undefined)
})

test('re-recovers an occluded window and still writes the PNG', async () => {
  const directory = workspace()
  const cdp = fakeCdp({
    // Surface capture stalls the way a hidden document does; the renderer-side
    // capture that follows the lifecycle/focus nudge produces the frame.
    'Page.captureScreenshot': [
      () => { throw new Error('CDP timeout: Page.captureScreenshot') },
      (params) => {
        assert.deepStrictEqual(params, { format: 'png', fromSurface: false,
          captureBeyondViewport: true })
        return { data: png('recovered-frame') }
      },
    ],
    'Page.setWebLifecycleState': () => ({}),
    'Emulation.setFocusEmulationEnabled': () => ({}),
    'Emulation.setDeviceMetricsOverride': () => ({}),
  })

  const result = await captureEvidence(cdp, {
    directory,
    fileName: 'recovered.png',
    metrics: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  })

  assert.strictEqual(result.status, 'captured')
  assert.deepStrictEqual(fs.readFileSync(result.file), Buffer.from('recovered-frame'))
  assert.deepStrictEqual(result.attempts.map(attempt => attempt.status),
    ['failed', 'captured'])
  assert.strictEqual(result.attempts[1].timeoutMs, RECOVERY_ATTEMPT_TIMEOUT_MS)
  assert.deepStrictEqual(result.nudges,
    ['lifecycle=ok', 'focus=ok', 'metrics=ok'])
  const metricsCall = cdp.calls.find(call => call.method === 'Emulation.setDeviceMetricsOverride')
  assert.deepStrictEqual(metricsCall.params,
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
})

test('degrades with a recorded reason when the renderer is alive but hidden', async () => {
  const directory = workspace()
  const cdp = fakeCdp({
    'Page.captureScreenshot': () => { throw new Error('CDP timeout: Page.captureScreenshot') },
    'Page.setWebLifecycleState': () => { throw new Error('CDP timeout: lifecycle') },
    'Emulation.setFocusEmulationEnabled': () => ({}),
    'Runtime.evaluate': () => ({
      result: { value: JSON.stringify({ visibility: 'hidden', alive: true }) },
    }),
  })

  const result = await captureEvidence(cdp, { directory, fileName: 'degraded.png' })

  assert.strictEqual(result.status, 'degraded')
  assert.strictEqual(result.file, null)
  assert.strictEqual(result.visibility, 'hidden')
  assert.match(result.reason, /visibility=hidden/)
  assert.match(result.reason, /CDP timeout: Page\.captureScreenshot/)
  // Nothing was written, so a later reader cannot mistake a stale PNG for this run.
  assert.strictEqual(fs.existsSync(path.join(directory, 'degraded.png')), false)
  assert.deepStrictEqual(result.attempts.map(attempt => attempt.status),
    ['failed', 'failed'])
  // A failed nudge is evidence, not an abort.
  assert.deepStrictEqual(result.nudges, [
    'lifecycle=CDP timeout: lifecycle',
    'focus=ok',
  ])
  const probe = cdp.calls.find(call => call.method === 'Runtime.evaluate')
  assert.strictEqual(probe.timeoutMs, PROBE_TIMEOUT_MS)
})

test('still fails the run when the renderer stopped answering', async () => {
  const directory = workspace()
  const cdp = fakeCdp({
    'Page.captureScreenshot': () => { throw new Error('CDP timeout: Page.captureScreenshot') },
    'Page.setWebLifecycleState': () => ({}),
    'Emulation.setFocusEmulationEnabled': () => ({}),
    // A renderer that cannot evaluate is the case the gate exists to catch.
    'Runtime.evaluate': () => { throw new Error('CDP disconnected') },
  })

  await assert.rejects(
    captureEvidence(cdp, { directory, fileName: 'dead.png', label: 'matrix 16:9' }),
    /screenshot evidence "matrix 16:9" failed and the renderer is unresponsive/)
  assert.strictEqual(fs.existsSync(path.join(directory, 'dead.png')), false)
})

test('an empty payload counts as a failed attempt, not a captured file', async () => {
  const directory = workspace()
  const cdp = fakeCdp({
    'Page.captureScreenshot': [
      () => ({ data: '' }),
      () => ({ data: png('second-try') }),
    ],
    'Page.setWebLifecycleState': () => ({}),
    'Emulation.setFocusEmulationEnabled': () => ({}),
  })

  const result = await captureEvidence(cdp, { directory, fileName: 'later.png' })

  assert.strictEqual(result.status, 'captured')
  assert.strictEqual(result.attempts[0].error, 'empty screenshot payload')
  assert.deepStrictEqual(fs.readFileSync(result.file), Buffer.from('second-try'))
})

test('refuses to guess a destination', async () => {
  const cdp = fakeCdp({})
  await assert.rejects(captureEvidence(cdp, { fileName: 'x.png' }),
    /captureEvidence needs a directory and a file name/)
  await assert.rejects(captureEvidence(cdp, { directory: workspace() }),
    /captureEvidence needs a directory and a file name/)
  assert.strictEqual(cdp.calls.length, 0)
})

test('a captured PNG keeps its label so a degraded note can name it later', async () => {
  const directory = workspace()
  const cdp = fakeCdp({ 'Page.captureScreenshot': () => ({ data: png('frame') }) })

  const result = await captureEvidence(cdp, { directory, fileName: 'labelled.png',
    label: 'studio 1440x900' })

  assert.strictEqual(result.label, 'studio 1440x900')
})

test('the gate log names every degraded capture and nothing else', () => {
  const { reportScreenshotNotes } = require('./smoke-test')
  const lines = []
  const original = console.log
  console.log = (...args) => lines.push(args.join(''))
  try {
    reportScreenshotNotes('cover studio', [
      { status: 'captured', label: 'studio 1440x900' },
      { status: 'degraded', label: 'matrix 16:9',
        reason: 'renderer alive (visibility=hidden) but produced no frame' },
      { status: 'captured', label: 'studio light theme' },
    ])
  } finally {
    console.log = original
  }

  assert.strictEqual(lines.length, 1)
  assert.match(lines[0], /\[smoke-test\] screenshot evidence degraded \(cover studio\)/)
  assert.match(lines[0], /matrix 16:9/)
  assert.match(lines[0], /visibility=hidden/)
})
