import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha } from '../setup/captcha'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as profileService from '@/server/services/profileService'
import * as accountDeletionService from '@/server/services/accountDeletionService'
import * as accountExportService from '@/server/services/accountExportService'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as auditService from '@/server/services/auditService'
import { REVOKE_REASON } from '@/server/auth/constants'
import type { AuditContext } from '@/server/services/auditService'
import type { UserRow } from '@/server/db/types'

/**
 * `/me/activity` visibility (review P0-6).
 *
 * `auditRepo.SELF_VISIBLE_ACTIONS` is the whole contract of the activity tab: the
 * query is `action IN (…)`, so an action missing from that array is invisible no
 * matter how many rows were written. The pre-review design added a dozen new
 * self-service events without touching it — the tab would have shipped empty and no
 * existing test would have gone red.
 */

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-act' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PASSWORD = 'quiet river stone meadow'

let harness: TestHarness
let actor: AuditContext
let user: UserRow

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const result = await authService.register({
    email: 'member@example.com',
    password: PASSWORD,
    username: 'member',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'activity-device-key' },
    ...CONTEXT,
    ...issueCaptcha(),
  })
  user = result.user
  actor = { actorUserId: user.id, actorLabel: user.email, ip: '1.2.3.4', requestId: 'req-act' }
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

function actions(): string[] {
  const page = { page: 1, pageSize: 100, offset: 0 }
  return profileService.myActivity(user.id, page).rows.map((row) => row.action)
}

describe('self-visible activity', () => {
  it('shows the whole new lifecycle to its owner', () => {
    const db = getDb()
    // Every event the release introduces, written through the real audit service.
    const events: [string, Record<string, unknown>][] = [
      ['auth.email_verified', { purpose: 'verify' }],
      ['auth.email_verify_resent', {}],
      ['user.email_change_requested', { to: 'n***@example.com' }],
      ['user.email_change_cancelled', {}],
      ['user.email_changed', { from: 'a***@example.com', to: 'n***@example.com' }],
      ['user.email_verified_by_admin', { actor: 'owner' }],
      ['user.exported', { activityRows: 3 }],
      ['account.deletion_requested', { requiresConfirmation: true }],
      ['account.deletion_scheduled', { scheduledFor: 'x' }],
      ['account.deletion_cancelled', {}],
      ['account.deletion_confirmed_by_admin', { reason: 'ticket' }],
      ['account.deleted', { priorEmailMasked: 'a***@example.com' }],
    ]
    for (const [action, metadata] of events) {
      auditService.record(actor, { action, targetType: 'user', targetId: user.id, metadata })
    }
    const visible = actions()
    for (const [action] of events) {
      expect(visible, `${action} must be self-visible`).toContain(action)
    }
    // The IP is masked on the way out.
    const first = profileService.myActivity(user.id, { page: 1, pageSize: 5, offset: 0 }).rows[0]
    expect(first?.ipMasked).toBe('1.2.x.x')
    expect(db).toBeDefined()
  })

  it('never shows administrative actions to a normal user', () => {
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    const adminActor: AuditContext = {
      actorUserId: owner?.id ?? '',
      actorLabel: 'owner@example.com',
      ip: '9.9.9.9',
      requestId: 'req-admin',
    }
    // Administrative rows carry the target user id, so the ownership predicate
    // matches them; only the action allowlist keeps them out of the timeline.
    auditService.record(adminActor, {
      action: 'admin.sessions_revoked',
      targetType: 'user',
      targetId: user.id,
      metadata: { count: 2 },
    })
    auditService.record(adminActor, {
      action: 'admin.users_exported',
      targetType: 'user',
      targetId: user.id,
      metadata: { rows: 10 },
    })
    auditService.record(adminActor, {
      action: 'settings.update',
      targetType: 'user',
      targetId: user.id,
      metadata: {},
    })
    const visible = actions()
    expect(visible).not.toContain('admin.sessions_revoked')
    expect(visible).not.toContain('admin.users_exported')
    expect(visible).not.toContain('settings.update')
  })

  it('records real events end to end, not just hand-written audit rows', async () => {
    // A real export …
    accountExportService.exportFor(usersRepo.findById(getDb(), user.id)!, actor)
    // … and a real revocation …
    sessionsRepo.revokeAllForUser(getDb(), user.id, Date.now(), REVOKE_REASON.adminRevoked)
    auditService.record(actor, {
      action: 'auth.session_revoked',
      targetType: 'user',
      targetId: user.id,
      metadata: {},
    })
    // … and a real deletion request.
    accountDeletionService.request(
      usersRepo.findById(getDb(), user.id)!,
      { password: PASSWORD },
      { ip: '1.2.3.4', requestId: 'req-del', audit: actor },
    )
    const visible = actions()
    expect(visible).toContain('user.register')
    expect(visible).toContain('user.exported')
    expect(visible).toContain('account.deletion_requested')
  })
})
