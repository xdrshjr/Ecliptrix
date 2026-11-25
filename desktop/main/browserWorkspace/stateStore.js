'use strict'

// stateStore.js — the single source of truth the renderer mirrors (spec §4.1, §7).
// The shape is `BrowserWorkspaceState` in src/types/browserWorkspace.ts.
//
// Why a throttle: tab loading / title events can fire dozens of times per second;
// the renderer only needs the latest snapshot, so broadcasts are coalesced to
// ≤20/s (50 ms trailing). Activity entries are pushed immediately and separately.

const ACTIVITY_LIMIT = 100
const BROADCAST_INTERVAL_MS = 50

/**
 * @param {object} deps
 * @param {() => Partial<import('../../../src/types/browserWorkspace').BrowserWorkspaceState>} deps.collect
 *   Builds the live parts of the state (profiles, tabs, approvals, control, flags).
 * @param {(state: object) => void} deps.broadcast Sends `browser:state-changed`.
 * @param {(entry: object) => void} [deps.broadcastActivity] Sends `browser:activity`.
 * @param {() => number} [deps.now]
 * @param {typeof setTimeout} [deps.setTimer]
 */
function createStateStore(deps) {
  const now = deps.now || Date.now
  const setTimer = deps.setTimer || setTimeout
  const clearTimer = deps.clearTimer || clearTimeout
  let activity = []
  let timer = null
  let seq = 0

  /** @returns {object} Full BrowserWorkspaceState. */
  function getState() {
    return { v: 1, ...deps.collect(), activity: activity.slice() }
  }

  /** Request a (coalesced) state broadcast. */
  function touch() {
    if (timer) return
    timer = setTimer(() => {
      timer = null
      deps.broadcast(getState())
    }, BROADCAST_INTERVAL_MS)
    if (timer && timer.unref) timer.unref()
  }

  /**
   * Append an activity entry (ring buffer of 100). Returns the stored entry so a
   * running one can be completed later with `updateActivity`.
   * @param {{ kind: string, label: string, status?: string, durationMs?: number, errorCode?: string }} entry
   */
  function pushActivity(entry) {
    seq += 1
    const stored = {
      id: `act-${now().toString(36)}-${seq}`, ts: now(), status: 'ok', ...entry,
      label: String(entry.label).slice(0, 80),
    }
    activity.push(stored)
    if (activity.length > ACTIVITY_LIMIT) activity = activity.slice(-ACTIVITY_LIMIT)
    if (deps.broadcastActivity) deps.broadcastActivity(stored)
    touch()
    return stored
  }

  /** Patch a stored entry (running → ok/error) and re-broadcast it. */
  function updateActivity(id, patch) {
    const entry = activity.find((a) => a.id === id)
    if (!entry) return
    Object.assign(entry, patch)
    if (deps.broadcastActivity) deps.broadcastActivity(entry)
    touch()
  }

  /** Emit immediately (used on lock / unlock where waiting 50 ms would flash stale UI). */
  function flush() {
    if (timer) {
      clearTimer(timer)
      timer = null
    }
    deps.broadcast(getState())
  }

  return { getState, touch, flush, pushActivity, updateActivity, clearActivity() { activity = [] } }
}

module.exports = { createStateStore, ACTIVITY_LIMIT, BROADCAST_INTERVAL_MS }
