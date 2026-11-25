'use strict'

// control.js — who is driving the browser (spec §4.5.2).
//
// One holder at a time: idle | agent | user. The user is never blocked from typing
// (that would feel like a broken browser); instead real input flips the holder to
// `user`, and the Agent's NEXT command is refused with `user_in_control` so the two
// never fight over the keyboard. CDP-dispatched input is "trusted" too, which is why
// user-input events are ignored while a command runs and for 150 ms after (`TAIL`).

const TAIL_MS = 150
const USER_IDLE_RETURN_MS = 8000

/**
 * @param {object} deps
 * @param {() => number} [deps.now]
 * @param {() => { idle_release_seconds: number }} deps.getSettings
 * @param {() => boolean} deps.hasPendingApproval
 * @param {() => void} deps.onChange
 * @param {(runId: string) => void} deps.onReleased Run lost control: adopt tabs, drop overlay.
 */
function createControl(deps) {
  const now = deps.now || Date.now
  const state = { holder: 'idle', since: now(), runId: null, manual: false }
  let inflight = 0
  let lastCommandAt = 0
  let lastActingAt = 0
  let lastUserInputAt = 0

  function set(holder, runId = state.runId) {
    if (state.holder !== holder || state.runId !== runId) {
      state.holder = holder
      state.runId = runId
      state.since = now()
      deps.onChange()
    }
  }

  return {
    /** @returns {{ holder: string, since: number }} Shape of BrowserWorkspaceState.control. */
    view: () => ({ holder: state.holder, since: state.since }),
    holder: () => state.holder,
    runId: () => state.runId,
    lastUserInputAt: () => lastUserInputAt,

    /** Agent command arrives. @returns {{ ok: true } | { ok: false, code: string }} */
    acquire(runId) {
      if (state.holder === 'idle') { lastCommandAt = now(); state.manual = false; set('agent', runId); return { ok: true } }
      if (state.runId && state.runId !== runId) return { ok: false, code: 'browser_busy' }
      if (state.holder === 'user') return { ok: false, code: 'user_in_control' }
      lastCommandAt = now()
      return { ok: true }
    },

    /** Mark a command running; `end` starts the 150 ms tail. */
    begin() { inflight += 1; lastCommandAt = now(); lastActingAt = now() },
    end() { inflight = Math.max(0, inflight - 1); lastCommandAt = now(); lastActingAt = now() },
    inflight: () => inflight,
    agentActing: () => inflight > 0 || now() - lastActingAt < TAIL_MS,

    /** Sentinel callback: a trusted user event happened in an agent-visible page. */
    userInput() {
      const t = now()
      if (inflight > 0 || t - lastActingAt < TAIL_MS) return
      lastUserInputAt = t
      if (state.holder === 'agent') { state.manual = false; set('user') }
    },

    takeOver() { state.manual = true; set('user') },
    /** User hands control back; no live run → back to idle. */
    returnControl() {
      state.manual = false
      lastUserInputAt = 0
      set(state.runId ? 'agent' : 'idle')
    },

    release(runId) {
      if (runId && state.runId !== runId) return false
      const was = state.runId
      state.manual = false
      inflight = 0
      set('idle', null)
      if (was) deps.onReleased(was)
      return Boolean(was)
    },

    /** Periodic: idle release (45 s default) and the 8 s auto-return after user input. */
    tick() {
      const t = now()
      if (state.holder === 'user' && !state.manual && state.runId && t - lastUserInputAt > USER_IDLE_RETURN_MS) {
        set('agent')
      }
      const limit = deps.getSettings().idle_release_seconds * 1000
      if (state.holder === 'agent' && inflight === 0 && !deps.hasPendingApproval() && t - lastCommandAt > limit) {
        this.release(state.runId)
      }
    },
  }
}

module.exports = { createControl, TAIL_MS, USER_IDLE_RETURN_MS }
