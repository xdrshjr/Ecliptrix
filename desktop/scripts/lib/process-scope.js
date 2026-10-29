/* eslint-disable @typescript-eslint/no-require-imports -- Electron uses CommonJS. */
'use strict'

const { processesUnder } = require('./process-cleanup')

// Module default, deliberately the same strict 10 s as
// waitForNoProcessesUnder() in process-cleanup.js: a longer grace belongs to
// the one call site that needs it (smoke-test.js's research-browser drain),
// not to every caller that forgets to pass a value.
const DEFAULT_TIMEOUT_MS = 10 * 1000
const DEFAULT_INTERVAL_MS = 250

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Normalise a PID list into a Set of strings, so `123` and `"123"` are the
 * same process (processesUnder returns strings, callers may pass numbers).
 *
 * @param {Array<string|number>} pids PIDs in either representation.
 * @returns {Set<string>} Normalised PIDs.
 */
function toPidSet(pids) {
  return new Set((pids || []).map((pid) => String(pid)))
}

/**
 * Pick the PIDs the research-browser smoke may have leaked.
 *
 * A PID counts as a leak when it is visible after the check but was NOT part
 * of the app-under-test tree captured before it. The baseline is the whole
 * reason this helper exists: the smoke runs against a LIVE app, so the main
 * process, renderers, the backend Python and the browser host are all under
 * the unpacked directory by design and must never be reported.
 *
 * The Python the check spawns is still caught: it is born after the snapshot,
 * so its PID (and those of same-exe descendants) cannot be in the baseline.
 *
 * @param {{after: Array<string|number>, baseline: Array<string|number>}} input
 *   `after` is the post-check process list, `baseline` the pre-check one.
 * @returns {string[]} Leaked PIDs in first-seen order; empty when none.
 */
function selectLeakedProcesses({ after, baseline }) {
  const appOwned = toPidSet(baseline)
  return [...toPidSet(after)].filter((pid) => !appOwned.has(pid))
}

/**
 * Poll the unpacked directory until nothing leaked by the check is left.
 *
 * The grace window is what distinguishes a still-draining child from a real
 * leak, without ever letting the app's own baseline tree fail the wait.
 *
 * @param {string} unpackedDir Directory the app under test runs from.
 * @param {object} options Baseline snapshot plus injection seams for tests.
 * @param {Array<string|number>} options.baseline Pre-check process list.
 * @param {number} [options.timeoutMs] Grace window; defaults to
 *   DEFAULT_TIMEOUT_MS (10 s). Callers whose child drains slower pass their
 *   own value rather than widening this module default.
 * @param {number} [options.intervalMs] Poll interval (default 250 ms).
 * @param {(dir: string) => string[]} [options.listProcesses] Enumerator.
 * @param {(ms: number) => Promise<void>} [options.sleep] Waiter.
 * @param {() => number} [options.now] Clock.
 * @returns {Promise<string[]>} PIDs still leaked after the window; [] = clean.
 */
async function waitForNoLeakedProcesses(unpackedDir, options) {
  const baseline = options.baseline
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const listProcesses = options.listProcesses || processesUnder
  const wait = options.sleep || defaultSleep
  const now = options.now || Date.now
  const deadline = now() + timeoutMs

  for (;;) {
    const leaked = selectLeakedProcesses({
      after: listProcesses(unpackedDir),
      baseline,
    })
    if (leaked.length === 0) return []
    const remainingMs = deadline - now()
    if (remainingMs <= 0) return leaked
    await wait(Math.min(intervalMs, remainingMs))
  }
}

module.exports = { selectLeakedProcesses, waitForNoLeakedProcesses }
