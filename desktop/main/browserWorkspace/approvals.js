'use strict'

// approvals.js — the three human gates as one lifecycle (spec §4.5.3, D-BW2-7):
// consent (first agent use of a profile), risky_action, handoff (login / captcha).
//
// Why a long-poll `wait()` instead of a push: the backend is the only client of
// the control server and talks plain HTTP; it asks "has the user decided?" with
// `GET /v1/approvals/{id}?wait_ms=` and gets an answer as soon as the renderer
// resolves it or the TTL expires.

const crypto = require('crypto')

const DEFAULT_TTL_MS = { consent: 120_000, risky_action: 120_000, handoff: 300_000 }
const MAX_REASON = 200
const KEEP_FINISHED = 50

/**
 * @param {object} [deps]
 * @param {() => number} [deps.now]
 * @param {(approval: object) => void} [deps.onChange] Any list change (state broadcast).
 * @param {(approval: object, decision: string) => void} [deps.onResolved] approve / approve_scope / deny.
 * @param {() => string} [deps.newId]
 * @param {typeof setTimeout} [deps.setTimer]
 * @param {typeof clearTimeout} [deps.clearTimer]
 * @param {Partial<typeof DEFAULT_TTL_MS>} [deps.ttl]
 */
function createApprovals(deps = {}) {
  const now = deps.now || Date.now
  const newId = deps.newId || (() => crypto.randomUUID())
  const setTimer = deps.setTimer || setTimeout
  const clearTimer = deps.clearTimer || clearTimeout
  const ttl = { ...DEFAULT_TTL_MS, ...(deps.ttl || {}) }
  /** @type {Map<string, object>} */
  const items = new Map()
  const timers = new Map()
  const waiters = new Map()

  function notify(approval) {
    const list = waiters.get(approval.id)
    if (list && approval.status !== 'pending') {
      waiters.delete(approval.id)
      for (const wake of list) wake()
    }
    if (deps.onChange) deps.onChange(approval)
  }

  function prune() {
    const finished = [...items.values()].filter((a) => a.status !== 'pending')
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) items.delete(old.id)
  }

  function finish(approval, status, decision) {
    if (approval.status !== 'pending') return false
    approval.status = status
    if (decision) approval.decision = decision
    clearTimer(timers.get(approval.id))
    timers.delete(approval.id)
    prune()
    notify(approval)
    if (decision && deps.onResolved) deps.onResolved(approval, decision)
    return true
  }

  /**
   * Create (or reuse) a pending approval.
   * @param {{ kind: string, runId: string, reason?: string, target?: object, dedupeKey?: string }} input
   * @returns {object} The approval record (internal fields `dedupeKey` / `decision` included).
   */
  function create({ kind, runId, reason = '', target, dedupeKey }) {
    if (!DEFAULT_TTL_MS[kind]) throw new Error(`unknown approval kind: ${kind}`)
    if (dedupeKey) {
      for (const a of items.values()) {
        if (a.status === 'pending' && a.kind === kind && a.dedupeKey === dedupeKey) return a
      }
    }
    const createdAt = now()
    const approval = {
      id: newId(), kind, runId: String(runId || ''), reason: String(reason).slice(0, MAX_REASON),
      target, createdAt, expiresAt: createdAt + ttl[kind], status: 'pending', dedupeKey,
    }
    items.set(approval.id, approval)
    const timer = setTimer(() => finish(approval, 'expired'), ttl[kind])
    if (timer && timer.unref) timer.unref()
    timers.set(approval.id, timer)
    notify(approval)
    return approval
  }

  /**
   * Apply the user's decision. handoff: approve → completed, deny → cancelled.
   * @param {string} id
   * @param {'approve'|'approve_scope'|'deny'} decision
   * @returns {{ ok: boolean, code?: string, approval?: object }}
   */
  function resolve(id, decision) {
    const approval = items.get(id)
    if (!approval) return { ok: false, code: 'approval_not_found' }
    if (approval.status !== 'pending') return { ok: false, code: 'approval_not_pending' }
    let status = 'denied'
    if (decision !== 'deny') status = approval.kind === 'handoff' ? 'completed' : 'approved'
    else if (approval.kind === 'handoff') status = 'cancelled'
    finish(approval, status, decision)
    return { ok: true, approval }
  }

  /**
   * Long poll: resolves with the approval once it is no longer pending or when the wait expires.
   * @param {string} id
   * @param {number} waitMs
   * @returns {Promise<object|null>}
   */
  function wait(id, waitMs) {
    const approval = items.get(id)
    if (!approval) return Promise.resolve(null)
    if (approval.status !== 'pending' || waitMs <= 0) return Promise.resolve(approval)
    return new Promise((resolveWait) => {
      const wake = () => { clearTimer(timer); resolveWait(approval) }
      const timer = setTimer(() => {
        const list = waiters.get(id) || []
        waiters.set(id, list.filter((w) => w !== wake))
        resolveWait(approval)
      }, waitMs)
      waiters.set(id, [...(waiters.get(id) || []), wake])
    })
  }

  function cancelWhere(predicate) {
    for (const a of [...items.values()]) if (a.status === 'pending' && predicate(a)) finish(a, 'cancelled')
  }

  return {
    create,
    resolve,
    wait,
    get: (id) => items.get(id) || null,
    /** @returns {object[]} Pending approvals in the renderer-visible shape (no internal fields). */
    pending: () => [...items.values()].filter((a) => a.status === 'pending').map(publicView),
    cancelRun: (runId) => cancelWhere((a) => a.runId === runId),
    cancel: (id) => cancelWhere((a) => a.id === id),
    cancelAll: () => cancelWhere(() => true),
    hasPending: () => [...items.values()].some((a) => a.status === 'pending'),
  }
}

/** @param {object} a @returns {object} BrowserApproval (src/types/browserWorkspace.ts) */
function publicView(a) {
  const { id, kind, runId, reason, target, createdAt, expiresAt, status } = a
  return { id, kind, runId, reason, target, createdAt, expiresAt, status }
}

module.exports = { createApprovals, publicView, DEFAULT_TTL_MS }
