import nodemailer, { type Transporter } from 'nodemailer'
import { getConfig } from '@/server/config'
import { log } from '@/server/http/requestContext'

/**
 * Mail.
 *
 * SMTP is optional by design (spec §2.10): with no SMTP host the self-service
 * reset flow is replaced by an administrator-issued temporary password, and the
 * HTTP response for "request a reset" stays identical (`202`) either way so the
 * endpoint cannot be used to probe the mail configuration.
 *
 * Sending is fired from the caller without awaiting failures on the request path
 * where possible; a mail outage must never change an API result.
 */

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  const config = getConfig()
  if (!config.smtp.enabled) return null
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth:
      config.smtp.user && config.smtp.password
        ? { user: config.smtp.user, pass: config.smtp.password }
        : undefined,
  })
  return transporter
}

export function isMailEnabled(): boolean {
  return Boolean(getConfig().smtp.enabled)
}

export interface PasswordResetMail {
  to: string
  displayName: string
  resetUrl: string
  expiresInMinutes: number
}

/**
 * Send the password-reset message.
 *
 * @returns true when the provider accepted the message; false when mail is off
 *          or sending failed. Callers must not turn `false` into an API error.
 */
export async function sendPasswordResetMail(mail: PasswordResetMail): Promise<boolean> {
  const mailer = getTransporter()
  if (!mailer) return false
  const config = getConfig()
  const subject = '重置你的 Ecliptrix 账号口令'
  const text = [
    `${mail.displayName}，你好：`,
    '',
    '我们收到了重置你 Ecliptrix 账号口令的请求。点击下面的链接设置新口令：',
    mail.resetUrl,
    '',
    `该链接 ${mail.expiresInMinutes} 分钟内有效，且只能使用一次。`,
    '如果这不是你本人的操作，可以忽略本邮件，你的口令不会被更改。',
    '',
    '— Ecliptrix',
  ].join('\n')

  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b0b0c;color:#ededed;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#121214;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:28px">
    <h1 style="font-size:16px;margin:0 0 16px">重置你的 Ecliptrix 账号口令</h1>
    <p style="font-size:14px;line-height:1.6;color:#9a9a9e;margin:0 0 20px">${escapeHtml(mail.displayName)}，你好。点击下面的按钮设置新口令。</p>
    <a href="${escapeHtml(mail.resetUrl)}" style="display:inline-block;background:#3ecf8e;color:#06231a;font-size:13px;font-weight:600;padding:10px 18px;border-radius:6px;text-decoration:none">设置新口令</a>
    <p style="font-size:12px;line-height:1.6;color:#9a9a9e;margin:20px 0 0">该链接 ${mail.expiresInMinutes} 分钟内有效，且只能使用一次。若不是你本人操作，请忽略本邮件。</p>
  </div>
</body></html>`

  try {
    await mailer.sendMail({ from: config.smtp.from, to: mail.to, subject, text, html })
    return true
  } catch (error) {
    log('warn', 'password reset mail failed', {
      to: mail.to,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function buildResetUrl(token: string): string {
  const config = getConfig()
  return `${config.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
