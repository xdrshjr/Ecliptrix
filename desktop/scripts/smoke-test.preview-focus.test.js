/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  classifyFocusState,
  describeFocusFailure,
  evaluateFocusSamples,
} = require('./lib/preview-focus')

// Regression, final-gate-4/5/7 and 11/12/14. portraitCoverSmoke() asserted the
// cover-preview focus contract once, in the same tick as the pointer press and
// the Tab dispatch, and again once after Escape:
//
//   await pressWithPointer(cdp, '[data-cover-preview]')
//   for (const modifiers of [0, 8]) {
//     ... dispatch Tab ...
//     if (!await cdp.evaluate(".cover-preview-dialog[open]')?." +
//         "contains(document.activeElement)")) {
//       fail('native preview dialog Tab focus escaped')
//     }
//   }
//
// CoverPreviewDialog.tsx:22-36 only calls showModal() and closeButton.focus()
// from a React effect, i.e. one commit after the pointer event and one commit
// after the key event, so the single read raced the commit. It also collapsed
// "the dialog has not opened yet" and "focus is outside the open dialog" into
// one boolean, which is why runs 11/12/14 named an escape the log could not
// support. The gate now samples the state probe over a bounded settle
// window (lib/preview-focus.js + untilFocusSettled() in smoke-test.js).
//
// Both directions are pinned below: a focus-in-flight sample that settles MUST
// be accepted (otherwise every viewport iteration fails the gate) and focus
// sitting outside an OPEN modal dialog MUST be rejected (otherwise the
// accessibility contract this check exists for is no longer guarded).

// What the probe reads between the pointer press and the React commit: the
// dialog is not open yet and focus is still on (or has left) the page body.
const IN_FLIGHT = {
  dialogPresent: true,
  dialogOpen: false,
  activeTag: 'BODY',
  activeIsPreviewTrigger: false,
  activeInDialog: false,
  previewTriggerPresent: true,
  studioPresent: true,
  documentFocused: true,
}

// The dialog is open and its close button owns focus: the contract holds.
const INSIDE_DIALOG = {
  ...IN_FLIGHT,
  dialogOpen: true,
  activeTag: 'BUTTON',
  activeId: 'preview-close',
  activeClass: 'cover-dialog-close',
  activeInDialog: true,
}

// The defect the check exists for: a modal dialog is open and focus escaped to
// the page behind it.
const FOCUS_ESCAPED = {
  ...IN_FLIGHT,
  dialogOpen: true,
  activeTag: 'BUTTON',
  activeId: 'cover-apply',
  activeInDialog: false,
}

// Closed by Escape and focus restored to the trigger: the other contract.
const RESTORED = {
  ...IN_FLIGHT,
  activeTag: 'BUTTON',
  activeIsPreviewTrigger: true,
}

// Closed, but focus fell to the body instead of back to the trigger.
const FOCUS_LOST = { ...IN_FLIGHT, activeTag: 'BODY' }

function testFocusInFlightThenSettledIsAccepted() {
  const states = [IN_FLIGHT, IN_FLIGHT, INSIDE_DIALOG, INSIDE_DIALOG]
    .map(classifyFocusState)
  assert.deepStrictEqual(states, ['not-open', 'not-open', 'focused', 'focused'],
    'the commit-sized window must classify as not-open, never as an escape')
  const verdict = evaluateFocusSamples(
    [IN_FLIGHT, IN_FLIGHT, INSIDE_DIALOG, INSIDE_DIALOG],
    { expected: 'focused' })
  assert.strictEqual(verdict.settled, true,
    'focus that is briefly in flight and then lands must pass the gate')
  assert.strictEqual(verdict.lastState, 'focused',
    'the settled state is reported')
  assert.deepStrictEqual(verdict.stateCounts,
    { 'not-open': 2, focused: 2 }, 'the histogram keeps the transient')
  assert.strictEqual(verdict.reason, null, 'a settled sample has no reason')
}

function testFocusOutsideOpenDialogIsRejected() {
  const samples = Array(30).fill(FOCUS_ESCAPED)
  const verdict = evaluateFocusSamples(samples, { expected: 'focused' })
  assert.strictEqual(classifyFocusState(FOCUS_ESCAPED), 'escaped',
    'focus outside an open modal dialog is an escape, not a transient')
  assert.strictEqual(verdict.settled, false,
    'an open dialog that never owns focus must still fail the gate')
  assert.strictEqual(verdict.lastState, 'escaped', 'the real state is named')
  assert.ok(String(verdict.reason).includes('focused never held for 2'),
    'the reason must name the expected state and the floor: ' + verdict.reason)
}

function testEscapeNeverSettlesEvenLate() {
  const samples = [...Array(5).fill(IN_FLIGHT),
    ...Array(25).fill(FOCUS_ESCAPED)]
  const verdict = evaluateFocusSamples(samples, { expected: 'focused' })
  assert.strictEqual(verdict.settled, false,
    'a focused transient that ends outside the dialog is not a pass')
  assert.strictEqual(verdict.lastState, 'escaped',
    'the verdict is the state the window ended on')
}

function testNotOpenIsNotAnEscape() {
  const verdict = evaluateFocusSamples([IN_FLIGHT], { expected: 'focused' })
  assert.strictEqual(classifyFocusState(IN_FLIGHT), 'not-open',
    'a dialog that has not opened yet must not be reported as an escape')
  assert.strictEqual(verdict.settled, false,
    'not-open is retried, never accepted as the settled state')
  assert.deepStrictEqual(verdict.stateCounts, { 'not-open': 1 },
    'the diagnostic must separate not-open from escaped')
}

function testCloseNeedsFocusBackOnTheTrigger() {
  assert.strictEqual(classifyFocusState(RESTORED), 'closed',
    'closed with focus on the trigger is the restored contract')
  assert.strictEqual(classifyFocusState(FOCUS_LOST), 'not-open',
    'a closed layer that dropped focus is not restored')
  const verdict = evaluateFocusSamples(
    [RESTORED, RESTORED, FOCUS_LOST, FOCUS_LOST], { expected: 'closed' })
  assert.strictEqual(verdict.settled, false,
    'focus that fell to the body after closing must fail the gate')
  assert.strictEqual(verdict.lastState, 'not-open', 'the loss is named')
}

function testClosedDialogStillOpenIsRejected() {
  const stillOpen = Array(10).fill(INSIDE_DIALOG)
  const verdict = evaluateFocusSamples(stillOpen, { expected: 'closed' })
  assert.strictEqual(verdict.settled, false,
    'Escape that left the layer open is the final-gate-4/5/7 defect')
  assert.strictEqual(verdict.lastState, 'focused',
    'the report must show the dialog still holding focus')
}

function testSettledStateMustHoldForTwoSamples() {
  const oneRead = evaluateFocusSamples([INSIDE_DIALOG], { expected: 'focused' })
  assert.strictEqual(oneRead.settled, false,
    'a single lucky read taken during the commit must not pass')
  const twoReads = evaluateFocusSamples([INSIDE_DIALOG, INSIDE_DIALOG],
    { expected: 'focused' })
  assert.strictEqual(twoReads.settled, true,
    'two consecutive identical reads are the pinned floor')
  assert.strictEqual(evaluateFocusSamples([]).settled, false,
    'an empty sample never settles')
}

function testFailureMessageKeepsDiagnostics() {
  const verdict = evaluateFocusSamples([IN_FLIGHT, FOCUS_ESCAPED],
    { expected: 'focused' })
  const message = describeFocusFailure(
    'native preview dialog Tab focus escaped', verdict,
    { viewport: '900x640', modifiers: 8 })
  assert.ok(message.startsWith('native preview dialog Tab focus escaped: '),
    'the historical failure prefix must survive: ' + message)
  for (const fragment of ['"viewport":"900x640"', '"modifiers":8',
    '"dialogOpen":true', '"activeInDialog":false', '"activeTag":"BUTTON"',
    '"previewTriggerPresent":true', '"lastState":"escaped"', '"reason":']) {
    assert.ok(message.includes(fragment),
      'failure message must keep ' + fragment + ': ' + message)
  }
  const timedOut = describeFocusFailure(
    'timed out: preview closes and restores focus', verdict)
  assert.ok(timedOut.startsWith('timed out: preview closes and restores' +
    ' focus: '), 'the close wait keeps its own prefix: ' + timedOut)
}

const SMOKE_TEST = path.join(__dirname, 'smoke-test.js')

/**
 * Extract one declaration from the gate source.
 *
 * @param {string} name function or const identifier to slice out
 * @returns {string} source from the declaration to its next peer
 */
function gateSource(name) {
  const source = fs.readFileSync(SMOKE_TEST, 'utf8')
  const start = source.indexOf(`function ${name}(`) >= 0
    ? source.indexOf(`function ${name}(`)
    : source.indexOf(`const ${name} =`)
  if (start < 0) throw new Error(`smoke-test.js no longer declares ${name}`)
  const next = source.slice(start + 1).search(/\n(?:async )?function |\nconst /)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

function testGateRetriesInsteadOfAssertingOnce() {
  const scenario = gateSource('portraitCoverSmoke')
  assert.ok(!scenario.includes("cover-preview-dialog[open]')" +
    '?.contains(document.activeElement)'),
  'the same-tick Tab assertion that raced the commit must be gone')
  assert.ok(!scenario.includes("fail('native preview dialog Tab focus" +
    " escaped')"), 'the escape must fail through the probing wait')
  const press = scenario.indexOf("pressWithPointer(cdp," +
    " '[data-cover-preview]')")
  const firstWait = scenario.indexOf('untilFocusSettled(cdp, {')
  const firstTab = scenario.indexOf("pressKey(cdp, 'Tab', 9, modifiers)")
  assert.ok(press >= 0 && firstWait > press,
    'the dialog must be waited for after the pointer press')
  assert.ok(firstTab > firstWait,
    'Tab may only be dispatched once the dialog owns focus')
  assert.ok(scenario.includes("expected: 'focused'"),
    'the Tab checks must settle on the focused state')
  assert.ok(scenario.includes("failure: 'native preview dialog Tab focus" +
    " escaped'"), 'the historical escape message must survive')
}

function testGateCloseWaitRetriesWithDiagnostics() {
  const scenario = gateSource('portraitCoverSmoke')
  assert.ok(scenario.includes("untilFocusSettled(cdp, {"),
    'the close wait must go through the probing wait')
  assert.ok(scenario.includes("label: 'preview closes and restores focus'"),
    'the close wait keeps its label for log greps')
  assert.ok(scenario.includes("expected: 'closed'"),
    'the close wait must settle on the restored-focus state')
  assert.ok(!scenario.includes('PREVIEW_CLOSED_PROBE'),
    'the single-shot boolean probe must not survive next to the sampler')
}

function testGateImportsEveryFocusHelperItUses() {
  const source = fs.readFileSync(SMOKE_TEST, 'utf8')
  const start = source.indexOf("require('./lib/preview-focus')")
  assert.ok(start > 0, 'smoke-test.js must require lib/preview-focus')
  const open = source.lastIndexOf('const {', start)
  const imported = source.slice(open + 'const {'.length, start)
    .split(/[^A-Za-z]+/).filter(Boolean).sort()
  assert.deepStrictEqual(imported, ['describeFocusFailure',
    'evaluateFocusSamples'],
  'the gate must import exactly the focus helpers it calls')
  const helpers = require('./lib/preview-focus')
  for (const name of imported) {
    assert.strictEqual(typeof helpers[name], 'function',
      'lib/preview-focus must export ' + name)
  }
}

/** Fake CDP connection that replays a scripted probe sequence. */
function fakeCdp(plan) {
  const calls = { evaluate: 0 }
  return {
    calls,
    evaluate: () => {
      const probe = plan[Math.min(calls.evaluate, plan.length - 1)]
      calls.evaluate += 1
      return Promise.resolve(probe)
    },
  }
}

/** Run `action` with console.log captured, keeping the polling log quiet. */
async function withCapturedLog(action) {
  const logged = []
  const original = console.log
  console.log = (...args) => logged.push(args.join(' '))
  try {
    await action()
  } finally {
    console.log = original
  }
  return logged
}

async function testRetryAcceptsFocusInFlight() {
  const { untilFocusSettled } = require('./smoke-test')
  const cdp = fakeCdp([IN_FLIGHT, IN_FLIGHT, INSIDE_DIALOG, INSIDE_DIALOG])
  const logged = await withCapturedLog(() => untilFocusSettled(cdp, {
    label: 'native preview dialog takes focus',
    expected: 'focused',
    context: { viewport: '900x640' },
  }))
  assert.strictEqual(cdp.calls.evaluate, 4,
    'the wait must retry the transient and stop at the settled sample')
  assert.ok(logged.some(line => line.includes(
    '[smoke-test] waiting: native preview dialog takes focus')),
  'the wait must stay visible while it polls: ' + logged.join(' | '))
}

async function testRetryRejectsEscapedFocusWithProbe() {
  const { untilFocusSettled } = require('./smoke-test')
  const cdp = fakeCdp([FOCUS_ESCAPED])
  await assert.rejects(() => withCapturedLog(() => untilFocusSettled(cdp, {
    label: 'native preview dialog keeps Tab focus 8',
    expected: 'focused',
    failure: 'native preview dialog Tab focus escaped',
    timeoutMs: 30,
    context: { viewport: '900x640', modifiers: 8 },
  })), (error) => {
    assert.ok(error.message.startsWith(
      'native preview dialog Tab focus escaped: '),
    'the regression message must keep its prefix: ' + error.message)
    for (const fragment of ['"dialogOpen":true', '"activeInDialog":false',
      '"activeTag":"BUTTON"', '"lastState":"escaped"']) {
      assert.ok(error.message.includes(fragment),
        'gate failure must carry ' + fragment + ': ' + error.message)
    }
    return true
  })
}

async function testRetryAcceptsRestoredFocus() {
  const { untilFocusSettled } = require('./smoke-test')
  const cdp = fakeCdp([INSIDE_DIALOG, FOCUS_LOST, RESTORED, RESTORED])
  await withCapturedLog(() => untilFocusSettled(cdp, {
    label: 'preview closes and restores focus',
    expected: 'closed',
    timeoutMs: 2000,
    context: { viewport: '900x640' },
  }))
  assert.strictEqual(cdp.calls.evaluate, 4,
    'the close wait must retry the cleanup and stop once focus is restored')
}

async function testRetryRejectsDialogThatNeverCloses() {
  const { untilFocusSettled } = require('./smoke-test')
  const cdp = fakeCdp([INSIDE_DIALOG])
  await assert.rejects(() => withCapturedLog(() => untilFocusSettled(cdp, {
    label: 'preview closes and restores focus',
    expected: 'closed',
    timeoutMs: 30,
    context: { viewport: '960x600' },
  })), /timed out: preview closes and restores focus: .*"dialogOpen":true/)
}

function run() {
  testFocusInFlightThenSettledIsAccepted()
  testFocusOutsideOpenDialogIsRejected()
  testEscapeNeverSettlesEvenLate()
  testNotOpenIsNotAnEscape()
  testCloseNeedsFocusBackOnTheTrigger()
  testClosedDialogStillOpenIsRejected()
  testSettledStateMustHoldForTwoSamples()
  testFailureMessageKeepsDiagnostics()
  testGateRetriesInsteadOfAssertingOnce()
  testGateCloseWaitRetriesWithDiagnostics()
  testGateImportsEveryFocusHelperItUses()
}

run()

Promise.resolve()
  .then(testRetryAcceptsFocusInFlight)
  .then(testRetryRejectsEscapedFocusWithProbe)
  .then(testRetryAcceptsRestoredFocus)
  .then(testRetryRejectsDialogThatNeverCloses)
  .then(() => {
    console.log('smoke-test preview focus tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
