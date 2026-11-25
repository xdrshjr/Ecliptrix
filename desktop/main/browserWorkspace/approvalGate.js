'use strict'

// approvalGate.js — blocks an agent command until the user decides (spec §4.5.3, §4.3.3).
//
// Why the main process runs the risk gate itself: only here are the target's real
// name / href / form action known at click time, and it is the one place a shell-capable
// agent cannot reconfigure (the always-confirm tier ignores every setting). The backend
// may pre-announce, but this gate is authoritative.

const { classify } = require('./risk')

class WorkspaceError extends Error {
  /**
   * @param {string} code Error code from spec §6.3.
   * @param {object} [details]
   */
  constructor(code, details) {
    super(code)
    this.code = code
    this.details = details || {}
  }
}

/**
 * Wait for an approval to leave `pending`, honouring cancellation of the owning command.
 * @param {object} approvals createApprovals() instance.
 * @param {string} id
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} Final approval record.
 */
async function waitForDecision(approvals, id, signal) {
  for (;;) {
    if (signal && signal.aborted) {
      approvals.cancel(id)
      throw new WorkspaceError('command_cancelled')
    }
    const current = await approvals.wait(id, 1000)
    if (!current) throw new WorkspaceError('approval_not_found')
    if (current.status !== 'pending') return current
  }
}

const RECENT_APPROVAL_MS = 90_000

/**
 * The backend pre-confirms from its snapshot (spec backend note 4); when it already got a yes for this
 * very run/host/label a moment ago, consume that yes instead of asking the user a second time.
 * @param {Map<string, number>|undefined} recent key → epoch ms of the approval.
 * @returns {boolean}
 */
function consumeRecentApproval(recent, key, now = Date.now) {
  if (!recent || !recent.has(key)) return false
  const fresh = now() - recent.get(key) < RECENT_APPROVAL_MS
  recent.delete(key)
  return fresh
}

/**
 * @param {object} deps
 * @param {object} deps.approvals
 * @param {Map<string, number>} [deps.recentApprovals] `runId|host|label` of risky approvals the user just allowed.
 * @param {() => number} [deps.now]
 * @param {Set<string>} deps.scopeAllowed `runId|host` pairs the user allowed for the run.
 * @param {() => object} deps.getSettings
 * @param {(host: string) => Promise<boolean>} deps.hasProfileCookies
 */
function createRiskGate(deps) {
  /**
   * @param {{ runId: string, kind: 'click'|'press_enter', host: string, target: object, autonomy?: string }} input
   * @throws {WorkspaceError} risky_action_blocked_autonomous | risky_action_denied | command_cancelled
   */
  async function check({ runId, kind, host, target, autonomy }, signal) {
    const settings = deps.getSettings()
    const verdict = classify({
      kind, name: target.name, href: target.href, formAction: target.formAction, formMethod: target.formMethod,
      hasProfileCookies: await deps.hasProfileCookies(host), confirmLoggedIn: settings.confirm_risky_actions,
    })
    if (verdict === 'none') return
    if (autonomy === 'yolo') throw new WorkspaceError('risky_action_blocked_autonomous', { host })
    if (deps.scopeAllowed.has(`${runId}|${host}`)) return
    if (consumeRecentApproval(deps.recentApprovals, `${runId}|${host}|${String(target.name || '').slice(0, 80)}`, deps.now)) return
    const approval = deps.approvals.create({
      kind: 'risky_action', runId, reason: `${kind === 'press_enter' ? '提交' : '点击'}「${String(target.name || '').slice(0, 40)}」`,
      target: { host, label: String(target.name || '').slice(0, 40) },
    })
    const final = await waitForDecision(deps.approvals, approval.id, signal)
    if (final.status !== 'approved') throw new WorkspaceError('risky_action_denied', { host })
    if (final.decision === 'approve_scope') deps.scopeAllowed.add(`${runId}|${host}`)
  }
  return { check }
}

module.exports = { WorkspaceError, createRiskGate, waitForDecision, consumeRecentApproval }
