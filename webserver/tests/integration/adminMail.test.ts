import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import * as mailService from '@/server/services/mailService'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import { maskEmail } from '@/server/services/privacy'
import { GET as mailListRoute } from '@/app/api/v1/admin/mail/route'
import { GET as mailDetailRoute } from '@/app/api/v1/admin/mail/[id]/route'
import { POST as mailRetryRoute } from '@/app/api/v1/admin/mail/[id]/retry/route'
import * as authService from '@/server/services/authService'

/**
 * The outbox console.
 *
 * What is asserted is what an operator relies on: the recipient is masked, the
 * detail gives text and never html, and a row carrying a one-shot link refuses to be
 * retried (the stored body has `token=***`, so a retry would deliver a broken link).
 */

const ADMIN = 'http://127.0.0.1:8787'
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }

let harness: TestHarness
let token: string

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
  const login = await authService.login({
    identifier: 'owner@example.com',
    password: 'owner-password-123',
    client: 'desktop',
    device: { ...DEVICE, deviceKey: 'mail-admin-key' },
    ip: '10.6.6.6',
    userAgent: 'vitest',
    requestId: 'req-mail-admin',
  })
  token = login.tokens.accessToken
})

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 60))
  harness.teardown()
})

async function queueBoth() {
  const plain = await mailService.queue({
    template: 'new-device',
    to: 'ada@example.com',
    locale: 'zh-CN',
    userId: null,
    params: { displayName: 'Ada' },
  })
  const secret = await mailService.queue({
    template: 'password-reset',
    to: 'ada@example.com',
    locale: 'zh-CN',
    userId: null,
    params: { displayName: 'Ada', link: 'http://x/reset?token=abc' },
  })
  return { plain, secret }
}

function authed(path: string): Request {
  return new Request(`${ADMIN}${path}`, { headers: { authorization: `Bearer ${token}` } })
}

describe('admin mail outbox', () => {
  it('masks the recipient in the list', async () => {
    await queueBoth()
    const response = await mailListRoute(authed('/api/v1/admin/mail'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { rows: { toMasked: string }[]; total: number }
    }
    expect(body.data.total).toBe(2)
    for (const row of body.data.rows) {
      expect(row.toMasked).toBe('a***@example.com')
      expect(row.toMasked).not.toContain('ada@example.com')
    }
  })

  it('returns the rendered text but never html from the detail endpoint', async () => {
    const { secret } = await queueBoth()
    const response = await mailDetailRoute(
      authed(`/api/v1/admin/mail/${secret.id}`),
      { params: Promise.resolve({ id: secret.id }) },
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { text: string; subject: string; retryable: boolean; html?: string }
    }
    expect(body.data.html).toBeUndefined()
    expect(body.data.text).toContain('重置')
    // The token is redacted in the stored body.
    expect(body.data.text).toContain('token=***')
    expect(body.data.text).not.toContain('token=abc')
    expect(body.data.retryable).toBe(false)
  })

  it('refuses to retry a row with retryable = 0 and accepts the other one', async () => {
    const { plain, secret } = await queueBoth()

    const refused = await mailRetryRoute(
      new Request(`${ADMIN}/api/v1/admin/mail/${secret.id}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: secret.id }) },
    )
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { error_code: string }).error_code).toBe('conflict')

    const allowed = await mailRetryRoute(
      new Request(`${ADMIN}/api/v1/admin/mail/${plain.id}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id: plain.id }) },
    )
    expect(allowed.status).toBe(200)
    const body = (await allowed.json()) as { data: { status: string } }
    // No SMTP in the harness, so the retry stays captured — and says so.
    expect(body.data.status).toBe('captured')
  })

  it('reports the delivery mode and the last-24h counters', async () => {
    await queueBoth()
    const capabilities = mailService.capabilities()
    expect(capabilities.mode).toBe('outbox')
    expect(capabilities.configured).toBe(false)
    expect(capabilities.sent24h).toBe(0)
    expect(capabilities.failed24h).toBe(0)
    expect(capabilities.sendTimeoutMs).toBe(5000)
    expect(outboxRepo.countByStatusSince(getDb(), 0).captured).toBe(2)
    expect(maskEmail('ada@example.com')).toBe('a***@example.com')
  })

  it('paginates and filters by status', async () => {
    await queueBoth()
    const captured = outboxRepo.list(getDb(), { status: 'captured' }, { page: 1, pageSize: 10, offset: 0 })
    expect(captured.total).toBe(2)
    const sent = outboxRepo.list(getDb(), { status: 'sent' }, { page: 1, pageSize: 10, offset: 0 })
    expect(sent.total).toBe(0)
  })
})
