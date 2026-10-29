/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const {
  awaitStableState,
  describeReadinessFailure,
  describeReadinessLayoutProblems,
  evaluateReadinessSample,
  summarizeStates,
} = require('./lib/readiness-sample')

// Regression, final-gate-1/2/3. coverReadinessSmoke() waited once for
// `data-status="blocked"`, then sampled 60 requestAnimationFrame frames and
// required every one of them to read "blocked". A viewport change re-enters
// "checking" for ~300ms, and legitimately so: useCoverReadiness() publishes
// "checking" from its zero-layout ResizeObserver branch, and a remounted canvas
// restarts a 150ms resource wait (src/components/video/cover/useCoverReadiness.ts,
// pinned by its tests "零布局撤销ready且恢复可测量时重新判断" and "首次文档挂载、
// 设置返回均重新检查"). 1440x900 never resizes and passed; 900x640 recorded 19
// "checking" frames followed by 41 stable "blocked" frames, and the gate failed
// on the leading transient. The sampler now measures convergence instead.
//
// Both directions are pinned below: a bounded transient that settles MUST be
// accepted (otherwise every viewport change fails the gate) and a panel that
// never settles, or is still flapping, MUST be rejected (otherwise the check
// is disarmed and stops guarding readiness at all).

// The real 900x640 sample, abbreviated to the same shape.
const leadingTransient = [
  ...Array(19).fill('checking'),
  ...Array(41).fill('blocked'),
]

// Geometry from the failing run, kept so the message contract stays pinned.
const FAILING_GEOMETRY = {
  panelHeight: 64,
  footerBottom: 412.0000190734863,
  footerTop: 371.4285888671875,
  canvasBottom: 252.71429634094238,
  canvasWidth: 61.625003814697266,
  canvasHeight: 26.000001907348633,
  viewportHeight: 640,
}

function testBoundedTransientConverges() {
  const verdict = evaluateReadinessSample(leadingTransient)
  assert.strictEqual(verdict.converged, true,
    'a resize transient that settles into blocked must still pass')
  assert.strictEqual(verdict.convergedAt, 19,
    'the stable tail must be reported where it starts')
  assert.strictEqual(verdict.reason, null, 'a converged sample has no reason')
  assert.deepStrictEqual(verdict.unexpected, [],
    'checking is a tolerated transient, not an unexpected state')
}

function testSteadyStateNeedsNoTransient() {
  const verdict = evaluateReadinessSample(Array(60).fill('blocked'))
  assert.strictEqual(verdict.converged, true,
    'a panel already settled at the first frame must pass')
  assert.strictEqual(verdict.convergedAt, 0,
    'no transient means the stable tail starts at frame 0')
  assert.strictEqual(verdict.frames, 60, 'frame count is reported')
}

function testPermanentlyCheckingIsRejected() {
  const verdict = evaluateReadinessSample(Array(60).fill('checking'))
  assert.strictEqual(verdict.converged, false,
    'a panel that never leaves checking must fail the gate')
  assert.ok(String(verdict.reason).includes('never held'),
    'the verdict must say the expected state never held: ' + verdict.reason)
  assert.deepStrictEqual(verdict.stateCounts, { checking: 60 },
    'the histogram must survive for diagnosis')
}

function testFlappingSampleIsRejected() {
  const flapping = Array.from({ length: 60 },
    (_, index) => index % 2 ? 'blocked' : 'checking')
  const verdict = evaluateReadinessSample(flapping)
  assert.strictEqual(verdict.converged, false,
    'an alternating sample is a two-frame coincidence, not convergence')
  assert.strictEqual(verdict.convergedAt, null, 'no stable tail exists')
}

function testUnsettledTailIsRejected() {
  const verdict = evaluateReadinessSample(
    [...Array(40).fill('blocked'), ...Array(20).fill('checking')])
  assert.strictEqual(verdict.converged, false,
    'ending in checking means the layout regressed, not settled')
  assert.strictEqual(verdict.convergedAt, null,
    'a tail of the wrong state cannot be a stable tail')
}

function testShortTailIsNotEnough() {
  const short = [...Array(30).fill('checking'), ...Array(11).fill('blocked')]
  assert.strictEqual(evaluateReadinessSample(short).converged, false,
    'eleven settled frames are below the twelve-frame floor')
  assert.strictEqual(
    evaluateReadinessSample([...short, 'blocked']).converged, true,
    'twelve settled frames are the pinned floor and must pass')
}

function testUnexpectedStateIsReported() {
  const verdict = evaluateReadinessSample(
    [...Array(10).fill('checking'), ...Array(20).fill('unavailable')])
  assert.strictEqual(verdict.converged, false,
    'a panel stuck in a resource-failure state must fail the gate')
  assert.deepStrictEqual(verdict.unexpected, ['unavailable'],
    'unknown states are surfaced by name, not silently lumped in')
}

function testSummarizeStatesCountsEveryFrame() {
  const counts = summarizeStates(['checking', 'blocked', 'blocked'])
  assert.deepStrictEqual(counts, { checking: 1, blocked: 2 },
    'the histogram must count every sampled frame')
  assert.deepStrictEqual(summarizeStates([]), {},
    'an empty sample yields an empty histogram')
}

// The 900x640 geometry from the failing run: a 64px compact panel (cap 113),
// a footer inside the viewport, and a 61.6x26 preview that is small but still
// measurable. This combination must be accepted — the panel was 64px, not
// overflowing, so the geometry was never what failed the gate.
const BLOCKED_900x640 = {
  panelHeight: 64,
  footerTop: 371.4285888671875,
  footerBottom: 412.0000190734863,
  stageHeight: 58,
  framePresent: true,
  canvasWidth: 61.625003814697266,
  canvasHeight: 26.000001907348633,
  canvasBottom: 252.71429634094238,
}

function testRealBlockedLayoutIsAccepted() {
  const problems = describeReadinessLayoutProblems(BLOCKED_900x640, 640)
  assert.deepStrictEqual(problems, [],
    'the measured 900x640 blocked layout satisfies every layout assertion')
}

function testPanelTallerThanItsSlotIsRejected() {
  const geometry = { ...BLOCKED_900x640, panelHeight: 200 }
  assert.deepStrictEqual(describeReadinessLayoutProblems(geometry, 640),
    ['readiness panel 200px tall'],
    'a readiness panel past its 112px slot must fail the gate')
}

function testCollapsedPreviewIsRejected() {
  const geometry = { ...BLOCKED_900x640, framePresent: false,
    canvasWidth: undefined, canvasHeight: undefined, canvasBottom: undefined }
  assert.deepStrictEqual(describeReadinessLayoutProblems(geometry, 640),
    ['preview canvas has no layout'],
    'a preview that vanished entirely must fail, not silently pass')
}

function testFooterBelowViewportIsRejected() {
  const geometry = { ...BLOCKED_900x640, footerBottom: 700, footerTop: 660 }
  assert.deepStrictEqual(describeReadinessLayoutProblems(geometry, 640),
    ['footer below the viewport'],
    'a footer pushed out of the viewport must fail the gate')
}

function testPreviewOverlappingFooterIsRejected() {
  const geometry = { ...BLOCKED_900x640, canvasBottom: 380 }
  assert.deepStrictEqual(describeReadinessLayoutProblems(geometry, 640),
    ['preview overlaps the footer'],
    'a preview growing into the footer must fail the gate')
}

function testOnePixelToleranceAtTheViewportEdge() {
  const geometry = { ...BLOCKED_900x640, footerBottom: 641 }
  assert.deepStrictEqual(describeReadinessLayoutProblems(geometry, 640), [],
    'a footer exactly one pixel past the edge is rounding, not overflow')
}

function testFailureMessageKeepsDiagnostics() {
  const verdict = evaluateReadinessSample(Array(60).fill('checking'))
  const message = describeReadinessFailure(verdict, {
    viewport: '900x640', problems: ['footer below the viewport'],
    geometry: FAILING_GEOMETRY,
  })
  assert.ok(message.startsWith('readiness layout did not converge: '),
    'the historical failure prefix must survive: ' + message)
  for (const fragment of ['"viewport":"900x640"',
    '"stateCounts":{"checking":60}', '"footerBottom":412.0000190734863',
    '"canvasWidth":61.625003814697266', '"reason":']) {
    assert.ok(message.includes(fragment),
      'failure message must keep ' + fragment + ': ' + message)
  }
}

/** Frame supplier that loops a planned status sequence and counts calls. */
function fakeFrames(plan) {
  const sampler = { calls: 0 }
  sampler.sample = () => {
    const status = plan[sampler.calls % plan.length]
    sampler.calls += 1
    return status
  }
  return sampler
}

async function testAwaitStableStateStopsAtConvergence() {
  const frames = fakeFrames([...Array(19).fill('checking'),
    ...Array(41).fill('blocked')])
  const verdict = await awaitStableState({ sampleFrame: frames.sample })
  assert.strictEqual(verdict.converged, true, 'the bounded transient passes')
  assert.strictEqual(frames.calls, 31,
    'sampling must stop once the stable tail is complete, not run to 60')
  assert.strictEqual(verdict.history.length, 31, 'history matches the samples')
  assert.deepStrictEqual(verdict.stateCounts, { checking: 19, blocked: 12 },
    'the histogram is taken over the frames actually sampled')
}

async function testAwaitStableStateRejectsNeverSettling() {
  const frames = fakeFrames(['checking', 'blocked'])
  const verdict = await awaitStableState({
    sampleFrame: frames.sample, maxFrames: 20 })
  assert.strictEqual(verdict.converged, false,
    'a flapping panel must still fail within the frame budget')
  assert.strictEqual(verdict.frames, 20, 'the frame budget must be enforced')
  assert.strictEqual(frames.calls, 20,
    'sampling must stop at the budget instead of hanging')
}

async function testAwaitStableStateRejectsStuckChecking() {
  const frames = fakeFrames(['checking'])
  const verdict = await awaitStableState({
    sampleFrame: frames.sample, maxFrames: 24, stableFrames: 4 })
  assert.strictEqual(verdict.converged, false,
    'a permanently checking panel is a product defect, never a pass')
  assert.ok(String(verdict.reason).includes('blocked never held for 4'),
    'the reason must name the expected state and the floor: ' + verdict.reason)
}

async function testAwaitStableStateRequiresSampler() {
  await assert.rejects(() => awaitStableState({}),
    /needs a sampleFrame\(\) function/,
    'a missing sampler is a programming error, not a silent pass')
}

const SMOKE_TEST = path.join(__dirname, 'smoke-test.js')

/**
 * Extract the coverReadinessSmoke() body from the gate source.
 *
 * @returns {string} source of the scenario, without its following peers
 */
function readinessScenarioSource() {
  const source = fs.readFileSync(SMOKE_TEST, 'utf8')
  const start = source.indexOf('async function coverReadinessSmoke(')
  const end = source.indexOf('async function coverSmoke(')
  if (start < 0 || end <= start) {
    throw new Error('smoke-test.js no longer declares coverReadinessSmoke')
  }
  return source.slice(start, end)
}

function testGateReestablishedWaitAfterResize() {
  const scenario = readinessScenarioSource()
  assert.ok(scenario.includes('await sampleReadinessLayout(cdp, width, height)'),
    'every viewport iteration must go through the convergence sampler')
  assert.ok(!scenario.includes('overflow feedback remains blocked'),
    'the one-shot wait that raced the post-resize reflow must be gone')
  assert.ok(!scenario.includes('states.some(state =>'),
    'sampling every frame must no longer be all-or-nothing')
}

function testGateStillFailsOnNonConvergence() {
  const scenario = readinessScenarioSource()
  assert.ok(scenario.includes('if (!verdict.converged || problems.length)'),
    'the layout verdict must still be able to fail the gate')
  assert.ok(scenario.includes('describeReadinessFailure('),
    'the diagnostic failure message must survive')
}

function testGateSamplerEmulatesThenSamples() {
  const source = fs.readFileSync(SMOKE_TEST, 'utf8')
  const start = source.indexOf('async function sampleReadinessLayout(')
  const end = source.indexOf('// Keep CDP scenarios together')
  const sampler = source.slice(start, end)
  assert.ok(start > 0 && end > start,
    'smoke-test.js no longer declares sampleReadinessLayout')
  const emulationAt = sampler.indexOf('setDeviceMetricsOverride')
  const samplingAt = sampler.indexOf('awaitStableState(')
  assert.ok(emulationAt >= 0 && samplingAt > emulationAt,
    'the resolution change must precede the sample, never the reverse')
}

function testGateImportsEveryHelperItUses() {
  const source = fs.readFileSync(SMOKE_TEST, 'utf8')
  const start = source.indexOf("} = require('./lib/readiness-sample')")
  assert.ok(start > 0, 'smoke-test.js must require lib/readiness-sample')
  const open = source.lastIndexOf('const {', start)
  const imported = source.slice(open + 'const {'.length, start)
    .split(',').map(name => name.trim()).filter(Boolean).sort()
  assert.deepStrictEqual(imported, ['awaitStableState',
    'describeReadinessFailure', 'describeReadinessLayoutProblems'],
    'the gate must import exactly the helpers it calls')
  const helpers = require('./lib/readiness-sample')
  for (const name of imported) {
    assert.strictEqual(typeof helpers[name], 'function',
      'lib/readiness-sample must export ' + name)
  }
}

function run() {
  testBoundedTransientConverges()
  testSteadyStateNeedsNoTransient()
  testPermanentlyCheckingIsRejected()
  testFlappingSampleIsRejected()
  testUnsettledTailIsRejected()
  testShortTailIsNotEnough()
  testUnexpectedStateIsReported()
  testSummarizeStatesCountsEveryFrame()
  testFailureMessageKeepsDiagnostics()
  testRealBlockedLayoutIsAccepted()
  testPanelTallerThanItsSlotIsRejected()
  testCollapsedPreviewIsRejected()
  testFooterBelowViewportIsRejected()
  testPreviewOverlappingFooterIsRejected()
  testOnePixelToleranceAtTheViewportEdge()
  testGateReestablishedWaitAfterResize()
  testGateStillFailsOnNonConvergence()
  testGateSamplerEmulatesThenSamples()
  testGateImportsEveryHelperItUses()
}

run()

Promise.resolve()
  .then(testAwaitStableStateStopsAtConvergence)
  .then(testAwaitStableStateRejectsNeverSettling)
  .then(testAwaitStableStateRejectsStuckChecking)
  .then(testAwaitStableStateRequiresSampler)
  .then(() => {
    console.log('smoke-test readiness sampling tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
