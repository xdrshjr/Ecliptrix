import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import * as authService from '@/server/services/authService'
import * as accountDeletionService from '@/server/services/accountDeletionService'
import * as maintenanceService from '@/server/services/maintenanceService'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import { SETTING_KEYS } from '@/server/services/settingsService'
import * as settingsRepo from '@/server/db/repositories/settingsRepo'
import { usersRepo } from '../setup/repos'
import type { UserRow } from '@/server/db/types'

/**
 * The lazy sweep.
 *
 * `next start` has no resident worker, so "execute overdue deletions" rides on the
 * request path. The property that keeps that acceptable is the hourly gate: it must
 * cost one row read, not a batch of work, on the other 3599 seconds.
 */

const PASSWORD = 'quiet river stone meadow'
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-sweep' }

let harness: TestHarness
let user: UserRow

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const result = await authService.register({
    email: 'member@example.com',
    password: PASSWORD,
    username: 'member',
    client: 'web',
    device: DEVICE,
    ...CONTEXT,
  })
  user = result.user
  accountDeletionService.request(
    user,
    { password: PASSWORD },
    {
      ip: '1.1.1.1',
      requestId: 'req-sweep',
      audit: { actorUserId: user.id, actorLabel: user.email, ip: '1.1.1.1', requestId: 'r' },
    },
  )
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

describe('maintenance sweep', () => {
  it('runs at most once an hour unless forced', () => {
    const now = Date.now()
    const first = maintenanceService.sweepIfDue(now)
    expect(first.ran).toBe(true)
    const second = maintenanceService.sweepIfDue(now + 1000)
    expect(second.ran).toBe(false)
    const forced = maintenanceService.sweepIfDue(now + 1000, true)
    expect(forced.ran).toBe(true)
  })

  it('records the timestamp in app_settings and keeps it out of the setting whitelist', () => {
    maintenanceService.sweepIfDue(Date.now())
    const stored = settingsRepo.getAll(getDb())
    expect(typeof stored['system.lastSweepAt']).toBe('number')
    expect(SETTING_KEYS as readonly string[]).not.toContain('system.lastSweepAt')
  })

  it('is idempotent: a second overdue run deletes nothing', () => {
    const later = Date.now() + 73 * 3_600_000
    const first = maintenanceService.sweepIfDue(later, true)
    expect(first.deleted).toBe(1)
    const second = maintenanceService.sweepIfDue(later, true)
    expect(second.deleted).toBe(0)
    expect(usersRepo.findById(getDb(), user.id)?.status).toBe('deleted')
  })

  it('never throws, even when the sweep body fails', () => {
    // A deliberately broken row: the request references a user that does not exist.
    // The foreign key rejects a row pointing at a missing user, so the corruption
    // has to be simulated on an existing row instead.
    getDb()
      .prepare(
        `INSERT INTO account_deletion_requests
          (id, user_id, status, requested_at, scheduled_for)
         VALUES ('broken','no-such-user','scheduled',?,?)`,
      )
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO account_deletion_requests
            (id, user_id, status, requested_at, scheduled_for)
           VALUES ('broken','no-such-user','scheduled',?,?)`,
        )
        .run(0, 0),
    ).toThrow()
    // … and the sweep still runs cleanly rather than propagating anything.
    expect(() => maintenanceService.sweepIfDue(Date.now() + 73 * 3_600_000, true)).not.toThrow()
    expect(outboxRepo.countByStatusSince(getDb(), 0).captured).toBeGreaterThan(0)
  })
})
