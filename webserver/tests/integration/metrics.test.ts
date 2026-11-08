import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import * as authService from '@/server/services/authService'
import * as metricsService from '@/server/services/metricsService'
import * as accountDeletionService from '@/server/services/accountDeletionService'
import { usersRepo } from '../setup/repos'
import { GET as metricsRoute } from '@/app/api/v1/admin/metrics/route'

/**
 * Overview metrics.
 *
 * The series must have exactly the requested length (a chart with a varying number
 * of bars is a chart whose x-axis lies), and `days` out of range must be a 422 rather
 * than a silent clamp — an operator who asked for 365 days needs to know they got 90.
 */

const ADMIN = 'http://127.0.0.1:8787'
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }
const PASSWORD = 'quiet river stone meadow'

let harness: TestHarness
let token: string

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  await authService.register({
    email: 'member@example.com',
    password: PASSWORD,
    username: 'member',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'metrics-device-key' },
    ip: '10.5.5.5',
    userAgent: 'vitest',
    requestId: 'req-metrics',
  })
  const login = await authService.login({
    identifier: 'owner@example.com',
    password: 'owner-password-123',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'metrics-owner-key' },
    ip: '10.5.5.6',
    userAgent: 'vitest',
    requestId: 'req-metrics-owner',
  })
  token = login.tokens.accessToken
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

describe('overview metrics', () => {
  it('returns trend arrays of the requested length', () => {
    const now = Date.now()
    const view = metricsService.overview(now, 30)
    expect(view.registrationTrend).toHaveLength(30)
    expect(view.loginsTrend).toHaveLength(30)
    expect(view.sessionsTrend).toHaveLength(30)
    expect(view.rangeDays).toBe(30)
    // Today's sign-ups and sessions are counted.
    expect(view.loginsTrend.at(-1)!.count).toBeGreaterThan(0)
    expect(view.sessionsTrend.at(-1)!.count).toBeGreaterThan(0)
    // The bucket grid is UTC (metricsService.startOfDay), so the assertion must be
    // independent of the host timezone — a local-midnight window with UTC labels
    // used to shift every date by one day east of Greenwich.
    const todayUtc = new Date(Math.floor(now / 86_400_000) * 86_400_000).toISOString().slice(0, 10)
    expect(view.loginsTrend.at(-1)!.date).toBe(todayUtc)
    expect(view.sessionsTrend.at(-1)!.date).toBe(todayUtc)
    expect(view.registrationTrend.at(-1)!.date).toBe(todayUtc)
  })

  it('counts the verification rate and the pending deletions', () => {
    const before = metricsService.overview()
    expect(before.emailVerifiedRate).toBe(0)
    expect(before.pendingDeletions).toBe(0)

    const member = usersRepo.findByEmailOrUsername(getDb(), 'member@example.com', 'member')
    usersRepo.update(getDb(), member?.id ?? '', { email_verified_at: Date.now() } as never, Date.now())
    const afterVerify = metricsService.overview()
    expect(afterVerify.emailVerifiedRate).toBeGreaterThan(0)

    accountDeletionService.request(
      usersRepo.findById(getDb(), member?.id ?? '')!,
      { password: PASSWORD },
      {
        ip: '1.1.1.1',
        requestId: 'r',
        audit: { actorUserId: member?.id ?? '', actorLabel: 'm', ip: '1.1.1.1', requestId: 'r' },
      },
    )
    expect(metricsService.overview().pendingDeletions).toBe(1)
  })

  it('sums the client breakdown to the active sessions', () => {
    const view = metricsService.overview()
    const sum = view.clientBreakdown.reduce((total, entry) => total + entry.sessions, 0)
    expect(sum).toBe(view.activeSessions)
  })

  it('answers 422 for days out of range and 200 inside it', async () => {
    const bad = await metricsRoute(
      new Request(`${ADMIN}/api/v1/admin/metrics?days=365`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(bad.status).toBe(422)

    const good = await metricsRoute(
      new Request(`${ADMIN}/api/v1/admin/metrics?days=30`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    )
    expect(good.status).toBe(200)
    const body = (await good.json()) as { data: { rangeDays: number } }
    expect(body.data.rangeDays).toBe(30)
  })
})
