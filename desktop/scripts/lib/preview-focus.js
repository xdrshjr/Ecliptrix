/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

// The sample histogram has one definition; reuse it instead of growing a second
// copy of the same counting loop in a second module.
const { summarizeStates } = require('./readiness-sample')

// Regression, final-gate-4/5/7 and 11/12/14. portraitCoverSmoke() pressed the
// cover-preview trigger through CDP pointer input and then asserted, in the
// same tick and exactly once, that
//   document.querySelector('.cover-preview-dialog[open]')?.contains(
//     document.activeElement)
// is true. CoverPreviewDialog.tsx only calls showModal() and takes focus from a
// React effect (src/components/video/cover/CoverPreviewDialog.tsx:22-36), i.e.
// one commit after the pointer event, so the assertion read `undefined`
// whenever the effect had not run yet — and reported that as "Tab focus
// escaped" (runs 11/12/14). The same boolean could not separate "dialog not
// open yet" from "focus really left the modal", so a failure cost a whole
// 40-minute soak without saying which defect it was.
//
// The gate now samples the state probe over a bounded settle window instead:
// a commit-sized transient is retried, and the state the window ends on is the
// verdict. Both directions stay live — an open modal dialog that does not own
// focus at the end of the window is still a hard failure (the product promises
// native Esc closes the layer and focus returns to the trigger), and a dialog
// that closes without returning focus is still a hard failure.

// Focus inside an open modal dialog: the state the Tab checks settle on.
const FOCUSED = 'focused'
// An open dialog that does not contain document.activeElement: real escape.
const ESCAPED = 'escaped'
// No open dialog and focus is back on the preview trigger: closed, restored.
const CLOSED = 'closed'
// No open dialog and focus is elsewhere: opening or restoring is in flight, or
// focus was genuinely lost. Retried, never a pass.
const NOT_OPEN = 'not-open'

// Two consecutive identical samples: the state has to hold for one poll
// interval (300ms in the gate) instead of being one lucky read taken while the
// commit was still landing.
const DEFAULT_STABLE_SAMPLES = 2

/**
 * Classify one PREVIEW_STATE_PROBE snapshot.
 *
 * Pure: no DOM, timers or CDP access. `focused` and `closed` are the only
 * states a wait may settle on; `not-open` is the commit-sized window between
 * the pointer press and showModal() (and between Escape and the cleanup's
 * trigger.focus()); `escaped` is what the accessibility contract forbids while
 * a modal dialog is open.
 *
 * @param {{dialogOpen?: boolean, activeInDialog?: boolean,
 *   activeIsPreviewTrigger?: boolean}} probe one snapshot from the gate's
 *   PREVIEW_STATE_PROBE. Its remaining fields (activeTag, activeId,
 *   activeClass, previewTriggerPresent, studioPresent, documentFocused) are
 *   diagnostics and do not influence the classification
 * @returns {'focused'|'escaped'|'closed'|'not-open'} the focus state
 */
function classifyFocusState(probe) {
  if (probe?.dialogOpen === true) {
    return probe.activeInDialog === true ? FOCUSED : ESCAPED
  }
  return probe?.activeIsPreviewTrigger === true ? CLOSED : NOT_OPEN
}

/**
 * Judge the probe snapshots a focus wait has collected so far.
 *
 * Pure: the verdict is a function of the sample list alone, so a future change
 * to the polling code cannot quietly accept a settled escape.
 *
 * @param {object[]} samples probe snapshots in sampling order
 * @param {{expected?: string, stableSamples?: number}} [options] `expected` is
 *   the state the wait settles on ('focused' or 'closed'), `stableSamples` how
 *   many identical trailing samples count as settled
 * @returns {{settled: boolean, expected: string, samples: number,
 *   stableSamples: number, stateCounts: Object<string, number>,
 *   lastState: string|null, last: object|null, reason: string|null}} verdict;
 *   `last` is the raw snapshot the report prints and `reason` is null once the
 *   wait settled
 */
function evaluateFocusSamples(samples, options = {}) {
  const expected = options.expected || FOCUSED
  const stableSamples = options.stableSamples || DEFAULT_STABLE_SAMPLES
  const states = samples.map(classifyFocusState)
  const tail = states.slice(-stableSamples)
  const settled = tail.length === stableSamples &&
    tail.every(state => state === expected)
  const lastState = states.length ? states[states.length - 1] : null
  return {
    settled,
    expected,
    samples: states.length,
    stableSamples,
    stateCounts: summarizeStates(states),
    lastState,
    last: samples.length ? samples[samples.length - 1] : null,
    reason: settled ? null : `${expected} never held for ${stableSamples}` +
      ` consecutive samples within ${states.length} probes` +
      ` (last: ${lastState})`,
  }
}

/**
 * Build the gate's one-line failure report for a focus wait.
 *
 * Keeps the historical message prefix so existing log greps still match
 * ("native preview dialog Tab focus escaped", "timed out: preview closes and
 * restores focus") and appends the state probe: is the dialog open, is focus
 * inside it, which element owns it, is the trigger still there.
 *
 * @param {string} message the prefix, i.e. the wait's timeout message
 * @param {object} verdict an evaluateFocusSamples() verdict
 * @param {object} [context] extra fields such as `viewport` or `modifiers`
 * @returns {string} failure message for the smoke gate
 */
function describeFocusFailure(message, verdict, context = {}) {
  const report = {
    ...context,
    expected: verdict.expected,
    settled: verdict.settled,
    samples: verdict.samples,
    stableSamples: verdict.stableSamples,
    states: verdict.stateCounts,
    lastState: verdict.lastState,
    reason: verdict.reason,
    probe: verdict.last,
  }
  return `${message}: ${JSON.stringify(report)}`
}

module.exports = {
  classifyFocusState,
  describeFocusFailure,
  evaluateFocusSamples,
}
