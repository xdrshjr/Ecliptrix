/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

// Regression, final-gate-1/2/3. coverReadinessSmoke() used to wait once for
// `data-status="blocked"` and then demand that all 60 requestAnimationFrame
// samples read "blocked". A viewport change re-enters "checking" for ~300ms,
// and legitimately so: useCoverReadiness() publishes "checking" from its
// zero-layout ResizeObserver branch and restarts its 150ms resource wait when
// the canvas node is remounted (see src/components/video/cover/
// useCoverReadiness.ts and its tests "零布局撤销ready…" / "首次文档挂载…").
// The 1440x900 iteration never resizes and passed; 900x640 recorded 19
// "checking" frames followed by 41 stable "blocked" ones and failed.
//
// The gate therefore samples convergence: a bounded transient, then a stable
// tail of the expected state. A panel that never reaches the expected state,
// or that is still flapping when the frame budget runs out, still fails.

const DEFAULT_EXPECTED = 'blocked'
// Transient states a resize may publish before the panel settles.
const DEFAULT_TRANSIENT = ['checking']
// 4s of 60fps frames: the measured transient is ~0.3s, more is a defect.
const DEFAULT_MAX_FRAMES = 240
// ~200ms of identical frames: settled, not a two-frame coincidence.
const DEFAULT_STABLE_FRAMES = 12

/**
 * Count how often each readiness status appeared in one sample window.
 *
 * @param {string[]} states statuses in sampling order
 * @returns {Object<string, number>} status -> frame count
 */
function summarizeStates(states) {
  const counts = {}
  for (const status of states) {
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}

/**
 * Index where a long-enough trailing run of `expected` starts.
 *
 * @param {string[]} states statuses in sampling order
 * @param {string} expected status the layout must converge to
 * @param {number} stableFrames consecutive frames required
 * @returns {number|null} start index of that tail, or null when absent
 */
function stableTailStart(states, expected, stableFrames) {
  let run = 0
  for (let index = states.length - 1; index >= 0; index -= 1) {
    if (states[index] !== expected) break
    run += 1
  }
  return run >= stableFrames ? states.length - run : null
}

/**
 * Judge one sampled readiness window. Pure: no timers, DOM or CDP access.
 *
 * @param {string[]} states statuses in sampling order
 * @param {{expected?: string, stableFrames?: number,
 *   transient?: string[]}} [options] `expected` is the converged state,
 *   `stableFrames` how many identical trailing frames count as settled,
 *   `transient` the states tolerated before convergence
 * @returns {{converged: boolean, expected: string, frames: number,
 *   stableFrames: number, convergedAt: number|null, stateCounts:
 *   Object<string, number>, unexpected: string[], reason: string|null}}
 *   verdict; `convergedAt` is the frame index where the stable tail began and
 *   `reason` is null when the sample converged
 */
function evaluateReadinessSample(states, options = {}) {
  const expected = options.expected || DEFAULT_EXPECTED
  const stableFrames = options.stableFrames || DEFAULT_STABLE_FRAMES
  const transient = options.transient || DEFAULT_TRANSIENT
  const convergedAt = stableTailStart(states, expected, stableFrames)
  const converged = convergedAt !== null
  const stateCounts = summarizeStates(states)
  const unexpected = Object.keys(stateCounts).filter(status =>
    status !== expected && !transient.includes(status))
  return {
    converged,
    expected,
    frames: states.length,
    stableFrames,
    convergedAt,
    stateCounts,
    unexpected,
    reason: converged ? null : `${expected} never held for ${stableFrames}` +
      ` consecutive frames within ${states.length} samples`,
  }
}

/**
 * Observe one readiness status per animation frame until it converges.
 *
 * @param {{sampleFrame: () => (string|Promise<string>), expected?: string,
 *   stableFrames?: number, maxFrames?: number,
 *   transient?: string[]}} options `sampleFrame` observes frame N and returns
 *   the status the panel displays on it
 * @returns {Promise<object>} the evaluateReadinessSample() verdict plus
 *   `history`, the raw statuses in sampling order
 * @throws {TypeError} when `sampleFrame` is not a function
 */
async function awaitStableState(options = {}) {
  const { sampleFrame } = options
  if (typeof sampleFrame !== 'function') {
    throw new TypeError('awaitStableState needs a sampleFrame() function')
  }
  const maxFrames = options.maxFrames || DEFAULT_MAX_FRAMES
  const judge = states => evaluateReadinessSample(states, {
    expected: options.expected,
    stableFrames: options.stableFrames,
    transient: options.transient,
  })
  const history = []
  let verdict = judge(history)
  while (!verdict.converged && history.length < maxFrames) {
    history.push(String(await sampleFrame(history.length)))
    verdict = judge(history)
  }
  return { ...verdict, history }
}

/**
 * Build the gate's one-line failure report for a sampled viewport.
 *
 * Keeps the diagnostic content the old message had (state histogram and
 * geometry) and drops the raw 240-frame history so the log stays readable.
 *
 * @param {object} verdict an evaluateReadinessSample()/awaitStableState()
 *   verdict
 * @param {object} [context] extra fields to report, e.g. `viewport`,
 *   `problems`, `geometry`
 * @returns {string} failure message for the smoke gate
 */
function describeReadinessFailure(verdict, context = {}) {
  const report = {
    converged: verdict.converged,
    expected: verdict.expected,
    reason: verdict.reason,
    frames: verdict.frames,
    stableFrames: verdict.stableFrames,
    settledAtFrame: verdict.convergedAt,
    stateCounts: verdict.stateCounts,
    ...context,
  }
  return `readiness layout did not converge: ${JSON.stringify(report)}`
}

// .cover-readiness is max-height:112px plus a 1px border; anything taller has
// grown past the slot the studio layout reserved for it.
const PANEL_MAX_HEIGHT = 113

/**
 * List the layout assertions the blocked sample still owes.
 *
 * The preview is expected to shrink with .cover-viewport, so the floor for the
 * frame is "has layout" — the readiness measurement only needs a measurable
 * box. A missing or zero-sized frame is still reported: it means the studio
 * collapsed the preview instead of fitting it.
 *
 * @param {object} geometry a geometry read from the live studio, with
 *   `panelHeight`, `footerTop`, `footerBottom`, `canvasWidth`, `canvasHeight`,
 *   `canvasBottom`
 * @param {number} viewportHeight emulated viewport height
 * @returns {string[]} problems, empty when the layout is acceptable
 */
function describeReadinessLayoutProblems(geometry, viewportHeight) {
  const problems = []
  if (geometry.panelHeight > PANEL_MAX_HEIGHT) {
    problems.push(`readiness panel ${geometry.panelHeight}px tall`)
  }
  if (!(geometry.canvasWidth > 0 && geometry.canvasHeight > 0)) {
    problems.push('preview canvas has no layout')
  }
  if (geometry.footerBottom > viewportHeight + 1) {
    problems.push('footer below the viewport')
  }
  if (geometry.canvasBottom > geometry.footerTop + 1) {
    problems.push('preview overlaps the footer')
  }
  return problems
}

module.exports = {
  awaitStableState,
  describeReadinessFailure,
  evaluateReadinessSample,
  describeReadinessLayoutProblems,
  summarizeStates,
}
