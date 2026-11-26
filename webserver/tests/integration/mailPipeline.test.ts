import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { issueCaptcha } from '../setup/captcha'
import { getDb } from '@/server/db/client'
import { resetAll } from '@/server/auth/rateLimit'
import { usersRepo } from '../setup/repos'
import * as authService from '@/server/services/authService'
import * as mailService from '@/server/services/mailService'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import { setTransportFactoryForTests, transportOptions } from '@/server/mail/mailer'
import type { Transporter } from 'nodemailer'

/**
 * The mail pipeline: render → persist → one bounded attempt → status.
 *
 * Two properties are load-bearing and both are asserted here:
 *  1. the outbox row exists BEFORE the attempt, so a crash mid-send leaves evidence;
 *  2. a delivery failure never reaches the API result — the caller's response must
 *     be identical whether SMTP works, is missing, or explodes.
 *
 * The "no SMTP" cases use the harness default (SMTP_HOST unset); the failure cases
 * inject a transport that throws, because a timeout test would take 5 seconds and
 * prove less.
 */

const CONTEXT = { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-mail' }
const DEVICE = { name: 'vitest', platform: 'win32', appVersion: '0.1.0' }

let harness: TestHarness

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
})

afterEach(() => {
  setTransportFactoryForTests(null)
  harness.teardown()
})

function queueInput(overrides: Partial<Parameters<typeof mailService.queue>[0]> = {}) {
  return {
    template: 'new-device' as const,
    to: 'ada@example.com',
    locale: 'zh-CN' as const,
    userId: null,
    params: { displayName: 'Ada' },
    ...overrides,
  }
}

/**
 * Wait for a background-queued mail to leave `captured`.
 *
 * `queueInBackground` deliberately does not block the request, so a test has to
 * wait for the attempt instead of asserting on the race.
 */
async function waitForMail(template: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rows = outboxRepo.list(getDb(), { template }, { page: 1, pageSize: 5, offset: 0 })
    const row = rows.rows[0]
    if (row && row.status !== 'captured') return row
    if (Date.now() > deadline) return row
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('mail pipeline', () => {
  it('persists the outbox row before the send attempt', async () => {
    let rowsDuringSend = -1
    setTransportFactoryForTests(
      () =>
        ({
          sendMail: async () => {
            // By the time the transport runs, the row must already be visible.
            rowsDuringSend = outboxRepo.list(getDb(), {}, {
              page: 1,
              pageSize: 10,
              offset: 0,
            }).total
            return { accepted: ['ada@example.com'] }
          },
        }) as unknown as Transporter,
    )
    harness.teardown()
    harness = await createHarness({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' })

    const result = await mailService.queue(queueInput())
    expect(rowsDuringSend).toBe(1)
    expect(result.status).toBe('sent')
    const row = outboxRepo.findById(getDb(), result.id)
    expect(row?.status).toBe('sent')
    expect(row?.attempts).toBe(1)
    expect(row?.sent_at).not.toBeNull()
  })

  it('leaves the api result unchanged when the smtp host rejects the message', async () => {
    harness.teardown()
    harness = await createHarness({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' })
    setTransportFactoryForTests(
      () =>
        ({
          sendMail: async () => {
            const error = new Error('connect ECONNREFUSED 127.0.0.1:2525')
            error.name = 'ESOCKET'
            throw error
          },
        }) as unknown as Transporter,
    )

    // Registration must answer 201 regardless of the mail outcome.
    const registered = await authService.register({
      email: 'mailed@example.com',
      password: 'a-long-and-unique-passphrase',
      username: 'mailed',
      client: 'web',
      device: DEVICE,
      ...CONTEXT,
      ...issueCaptcha(),
    })
    expect(registered.user.email).toBe('mailed@example.com')

    // The verification mail is fire-and-forget by design, so wait for the attempt
    // to settle rather than asserting on a race.
    const verification = await waitForMail('verify-email')
    expect(verification?.status).toBe('failed')
    // Only the error class name is stored: a provider message can contain the host.
    expect(verification?.last_error).toBe('ESOCKET')
  })

  it('captures the mail instead of failing when no smtp is configured', async () => {
    const result = await mailService.queue(queueInput())
    expect(result.status).toBe('captured')
    const row = outboxRepo.findById(getDb(), result.id)
    expect(row?.attempts).toBe(0)
    expect(mailService.capabilities().mode).toBe('outbox')
  })

  it('enforces the daily cap of 20 per account without an attempt', async () => {
    const owner = usersRepo.findByEmailOrUsername(getDb(), 'owner@example.com', 'owner')
    expect(owner).toBeDefined()
    for (let index = 0; index < mailService.DAILY_CAP_PER_USER; index += 1) {
      await mailService.queue(queueInput({ userId: owner?.id ?? null }))
    }
    const capped = await mailService.queue(queueInput({ userId: owner?.id ?? null }))
    expect(capped.capped).toBe(true)
    const row = outboxRepo.findById(getDb(), capped.id)
    expect(row?.last_error).toBe('daily_cap')
    expect(row?.attempts).toBe(0)
  })

  it('refuses to retry a row that carries a one-shot token', async () => {
    const result = await mailService.queue(
      queueInput({ template: 'password-reset', params: { displayName: 'Ada', link: 'http://x/?token=abc' } }),
    )
    await expect(mailService.retry(result.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('retries a retryable row and reports the new status', async () => {
    const result = await mailService.queue(queueInput())
    // Still captured (no SMTP), so a retry is allowed and stays captured.
    const row = await mailService.retry(result.id)
    expect(row.id).toBe(result.id)
    expect(row.status).toBe('captured')
  })

  it('derives all three transport timeouts from MAIL_SEND_TIMEOUT_MS', async () => {
    harness.teardown()
    harness = await createHarness({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '2525',
      MAIL_SEND_TIMEOUT_MS: '1234',
    })
    const options = transportOptions()
    expect(options).not.toBeNull()
    expect(options?.connectionTimeout).toBe(1234)
    expect(options?.greetingTimeout).toBe(1234)
    expect(options?.socketTimeout).toBe(1234)
    expect(harness.config.mailSendTimeoutMs).toBe(1234)
  })

  it('defaults the transport timeout to 5 seconds and returns null with no smtp', async () => {
    expect(transportOptions()).toBeNull()
    harness.teardown()
    harness = await createHarness({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' })
    expect(transportOptions()?.socketTimeout).toBe(5000)
  })
})
