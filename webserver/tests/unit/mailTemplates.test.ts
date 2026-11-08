import { describe, expect, it } from 'vitest'
import {
  MAIL_TEMPLATES,
  escapeHtml,
  isRetryableTemplate,
  renderMail,
  type MailParams,
} from '@/server/mail/templates'
import { redactTokens } from '@/server/services/mailService'

/**
 * Template rendering.
 *
 * The interesting failures are not "does it produce text" but "does it leak the
 * token into the outbox" and "does a display name containing markup break out of the
 * HTML body". Both are asserted directly.
 */

const PARAMS: MailParams = {
  displayName: 'Ada Lovelace',
  link: 'http://127.0.0.1:8787/verify-email?token=abc123def456',
  code: 'ECL-AAAA-BBBB-CCCC',
  expiresIn: '48 小时',
  scheduledFor: '2026-01-04 00:00',
  deviceName: 'ThinkPad',
  platform: 'win32',
  appVersion: '1.0.3',
  maskedEmail: 'a***@example.com',
}

describe('mail templates', () => {
  it('renders all 12 templates in both locales with a non-empty body', () => {
    expect(MAIL_TEMPLATES).toHaveLength(12)
    for (const template of MAIL_TEMPLATES) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        const rendered = renderMail(template, PARAMS, locale)
        expect(rendered.subject.length, `${template}/${locale} subject`).toBeGreaterThan(0)
        expect(rendered.text.length, `${template}/${locale} text`).toBeGreaterThan(0)
        expect(rendered.html).toContain('<!doctype html>')
      }
    }
  })

  it('keeps every subject within the 120 character budget', () => {
    for (const template of MAIL_TEMPLATES) {
      const rendered = renderMail(template, PARAMS, 'zh-CN')
      expect(rendered.subject.length).toBeLessThanOrEqual(120)
    }
  })

  it('never renders a token into the stored body once redacted', () => {
    const rendered = renderMail('verify-email', PARAMS, 'zh-CN')
    // The rendered message DOES carry the token (that is how the link works) …
    expect(rendered.text).toContain('token=abc123def456')
    // … but what the outbox stores is the redacted form.
    const stored = redactTokens(rendered.text)
    expect(stored).not.toContain('abc123def456')
    expect(stored).toContain('token=***')
  })

  it('redacts the invite code from the stored body, not just a token', () => {
    // The invite code is a registration credential printed as a bare line AND
    // embedded in a registration link. `redactTokens` used to match `token=` only,
    // so both survived verbatim into `mail_outbox.body_text` — readable by every
    // administrator and copied by `db:backup`.
    const rendered = renderMail(
      'invite',
      { ...PARAMS, link: 'http://127.0.0.1:8787/register?invite=ECL-AAAA-BBBB-CCCC' },
      'zh-CN',
    )
    expect(rendered.text).toContain('ECL-AAAA-BBBB-CCCC')
    const stored = redactTokens(rendered.text)
    expect(stored).not.toContain('ECL-AAAA-BBBB-CCCC')
    expect(stored).toContain('invite=***')
    // The English rendering prints the code on its own line too.
    const english = redactTokens(renderMail('invite', PARAMS, 'en-US').text)
    expect(english).not.toContain('ECL-AAAA-BBBB-CCCC')
  })

  it('never leaves a token in the redacted body of any template', () => {
    for (const template of MAIL_TEMPLATES) {
      for (const locale of ['zh-CN', 'en-US'] as const) {
        const stored = redactTokens(renderMail(template, PARAMS, locale).text)
        expect(stored, `${template}/${locale}`).not.toContain('abc123def456')
        expect(stored, `${template}/${locale}`).not.toContain('ECL-AAAA-BBBB-CCCC')
      }
    }
  })

  it('marks exactly the templates that carry a one-shot secret as non-retryable', () => {
    const secret = MAIL_TEMPLATES.filter((template) => !isRetryableTemplate(template))
    expect(secret.sort()).toEqual([
      'change-email-confirm',
      'deletion-confirm',
      'invite',
      'password-reset',
      'verify-email',
    ])
  })

  it('escapes html in every interpolation, so a display name cannot inject markup', () => {
    const rendered = renderMail(
      'new-device',
      { ...PARAMS, displayName: '<script>alert(1)</script>' },
      'en-US',
    )
    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).toContain('&lt;script&gt;')
    // The plain-text part keeps the raw characters: it is not HTML.
    expect(rendered.text).toContain('<script>')
    expect(escapeHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;')
  })

  it('rejects an unknown template loudly instead of mailing a blank body', () => {
    expect(() => renderMail('not-a-template' as never, PARAMS, 'zh-CN')).toThrow(
      /unknown mail template/,
    )
  })
})
