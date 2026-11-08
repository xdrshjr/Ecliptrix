import type { Locale } from '@/lib/i18n'

/**
 * Transactional mail templates.
 *
 * Pure functions only: no IO, no configuration, no database. `mailService` picks
 * the template, renders it, redacts secrets and persists the outbox row; the
 * SMTP layer (`mailer.ts`) only knows how to hand a rendered message to a
 * transport. Keeping rendering here is what makes "does the copy read right in
 * both languages" a unit test instead of a manual check.
 *
 * Two rules that are not negotiable:
 *  - every interpolation goes through `escapeHtml` in the HTML part, because a
 *    display name is user-controlled input (spec §8 R11);
 *  - a template that carries a one-time secret is `retryable: false`, because the
 *    outbox stores the body with `token=***` and a retry cannot replay it.
 */

export type MailTemplateKey =
  | 'password-reset'
  | 'verify-email'
  | 'change-email-confirm'
  | 'email-change-notice'
  | 'email-changed'
  | 'invite'
  | 'new-device'
  | 'password-changed'
  | 'deletion-confirm'
  | 'deletion-scheduled'
  | 'deletion-cancelled'
  | 'deletion-completed'

export const MAIL_TEMPLATES: readonly MailTemplateKey[] = [
  'password-reset',
  'verify-email',
  'change-email-confirm',
  'email-change-notice',
  'email-changed',
  'invite',
  'new-device',
  'password-changed',
  'deletion-confirm',
  'deletion-scheduled',
  'deletion-cancelled',
  'deletion-completed',
]

/**
 * Templates whose body contains a link with a one-shot token.
 *
 * A retry would resend `token=***`, so the console must offer "ask the user to
 * request a new one" instead of a retry button.
 */
const SECRET_TEMPLATES = new Set<MailTemplateKey>([
  'password-reset',
  'verify-email',
  'change-email-confirm',
  'invite',
  'deletion-confirm',
])

export function isRetryableTemplate(template: MailTemplateKey): boolean {
  return !SECRET_TEMPLATES.has(template)
}

export interface MailParams {
  /** Recipient's display name, or the masked address when unknown. */
  displayName: string
  /** Absolute URL for the templates that carry a one-shot link. */
  link?: string
  /** Invite code (plaintext, only ever present in one mail). */
  code?: string
  /** Human-readable duration, already localised by the caller ("48 小时"). */
  expiresIn?: string
  /** ISO date for the scheduled-deletion mails. */
  scheduledFor?: string
  deviceName?: string
  platform?: string
  appVersion?: string
  /** Masked form (`a***@b.c`) — never the plaintext address. */
  maskedEmail?: string
  appName?: string
}

export interface RenderedMail {
  subject: string
  text: string
  /** Not persisted; handed to the transport and dropped. */
  html: string
}

const SUPPORT_TAIL: Record<Locale, (appName: string) => string[]> = {
  'zh-CN': () => [
    '',
    '如果不是你本人的操作，请忽略本邮件并考虑修改口令。',
    '',
    '— Ecliptrix 账号服务（本邮件由系统自动发送，请勿直接回复）',
  ],
  'en-US': () => [
    '',
    'If this was not you, ignore this message and consider changing your password.',
    '',
    '— Ecliptrix account service (automated message, please do not reply)',
  ],
}

interface Body {
  subject: string
  lines: string[]
  cta?: string
}

function bodyFor(
  template: MailTemplateKey,
  params: MailParams,
  locale: Locale,
): Body {
  const name = params.displayName || (locale === 'zh-CN' ? '你好' : 'there')
  const appName = params.appName ?? 'Ecliptrix'
  const link = params.link ?? ''

  if (locale === 'en-US') {
    switch (template) {
      case 'password-reset':
        return {
          subject: `Reset your ${appName} password`,
          cta: 'Set a new password',
          lines: [
            `${name},`,
            '',
            `We received a request to reset the password of your ${appName} account.`,
            'Use the link below to choose a new one:',
            link,
            '',
            `The link${params.expiresIn ? ` expires in ${params.expiresIn}` : ''} and can be used once.`,
            ...SUPPORT_TAIL['en-US'](appName),
          ],
        }
      case 'verify-email':
        return {
          subject: `Verify your ${appName} email address`,
          cta: 'Verify email',
          lines: [
            `${name},`,
            '',
            `Confirm that ${params.maskedEmail ?? 'this address'} belongs to you and finish setting up your account.`,
            'Open the link below:',
            link,
            '',
            `The link${params.expiresIn ? ` expires in ${params.expiresIn}` : ''} and can be used once.`,
            ...SUPPORT_TAIL['en-US'](appName),
          ],
        }
      case 'change-email-confirm':
        return {
          subject: `Confirm your new ${appName} email address`,
          cta: 'Confirm the new address',
          lines: [
            `${name},`,
            '',
            'You asked to move your account to this address. Confirm it with the link below:',
            link,
            '',
            `The link${params.expiresIn ? ` expires in ${params.expiresIn}` : ''} and can be used once.`,
            'Your current address keeps working until you confirm.',
            ...SUPPORT_TAIL['en-US'](appName),
          ],
        }
      case 'email-change-notice':
        return {
          subject: `An email change was requested for your ${appName} account`,
          lines: [
            `${name},`,
            '',
            `Somebody asked to move your ${appName} account to a different address.`,
            'The change only takes effect after the new address confirms it. Until then this address keeps working.',
            '',
            'If this was not you, change your password now and contact support.',
          ],
        }
      case 'email-changed':
        return {
          subject: `Your ${appName} email address was changed`,
          lines: [
            `${name},`,
            '',
            'The address of your account has been changed and confirmed.',
            'For your safety every other signed-in device has been signed out.',
            '',
            'If this was not you, contact support immediately.',
          ],
        }
      case 'invite':
        return {
          subject: `You are invited to ${appName}`,
          cta: 'Create your account',
          lines: [
            `${name},`,
            '',
            `You have been invited to create an ${appName} account.`,
            `Your one-time invite code: ${params.code ?? ''}`,
            link,
            '',
            'The code can be used once and is shown only in this message.',
          ],
        }
      case 'new-device':
        return {
          subject: `New sign-in to your ${appName} account`,
          lines: [
            `${name},`,
            '',
            'A new device signed in to your account:',
            `Device: ${params.deviceName || 'unknown'}`,
            `Platform: ${params.platform || 'unknown'}`,
            `Client version: ${params.appVersion || 'unknown'}`,
            '',
            'If this was you, nothing to do. Otherwise change your password and sign that device out from the account centre.',
          ],
        }
      case 'password-changed':
        return {
          subject: `Your ${appName} password was changed`,
          lines: [
            `${name},`,
            '',
            'The password of your account was just changed.',
            'If this was you, nothing to do. Otherwise reset it immediately and contact support.',
          ],
        }
      case 'deletion-confirm':
        return {
          subject: `Confirm the deletion of your ${appName} account`,
          cta: 'Confirm deletion',
          lines: [
            `${name},`,
            '',
            'You asked to delete your account. Confirm it with the link below:',
            link,
            '',
            `The link${params.expiresIn ? ` expires in ${params.expiresIn}` : ''} and can be used once.`,
            'After confirming you still have a grace period in which the request can be cancelled.',
            'If this was not you, ignore this message — nothing happens without this confirmation.',
          ],
        }
      case 'deletion-scheduled':
        return {
          subject: `Your ${appName} account is scheduled for deletion`,
          lines: [
            `${name},`,
            '',
            `Your account is scheduled for deletion${params.scheduledFor ? ` on ${params.scheduledFor}` : ''}.`,
            'Until then you can sign in and cancel the request from the account centre:',
            link,
            '',
            'After that moment the account is anonymised and the action cannot be undone.',
          ],
        }
      case 'deletion-cancelled':
        return {
          subject: `Your ${appName} account deletion was cancelled`,
          lines: [
            `${name},`,
            '',
            'The deletion request for your account has been cancelled. Nothing was removed and your account keeps working.',
          ],
        }
      case 'deletion-completed':
        return {
          subject: `Your ${appName} account was deleted`,
          lines: [
            `${name},`,
            '',
            'The deletion you requested has been carried out.',
            'The account can no longer sign in and its personal data has been removed. Audit records that must be retained for compliance are kept in anonymised form.',
            '',
            'Thank you for having used Ecliptrix.',
          ],
        }
    }
  }

  switch (template) {
    case 'password-reset':
      return {
        subject: `重置你的 ${appName} 账号口令`,
        cta: '设置新口令',
        lines: [
          `${name}，你好：`,
          '',
          `我们收到了重置你 ${appName} 账号口令的请求。点击下面的链接设置新口令：`,
          link,
          '',
          `该链接${params.expiresIn ? ` ${params.expiresIn}内有效` : '在有效期内可用'}，且只能使用一次。`,
          ...SUPPORT_TAIL['zh-CN'](appName),
        ],
      }
    case 'verify-email':
      return {
        subject: `验证你的 ${appName} 邮箱地址`,
        cta: '验证邮箱',
        lines: [
          `${name}，你好：`,
          '',
          `请确认 ${params.maskedEmail ?? '该邮箱'} 属于你，并完成账号设置。`,
          '打开下面的链接：',
          link,
          '',
          `该链接${params.expiresIn ? ` ${params.expiresIn}内有效` : '在有效期内可用'}，且只能使用一次。`,
          ...SUPPORT_TAIL['zh-CN'](appName),
        ],
      }
    case 'change-email-confirm':
      return {
        subject: `确认你的新 ${appName} 邮箱地址`,
        cta: '确认新地址',
        lines: [
          `${name}，你好：`,
          '',
          '你申请把账号迁移到这个新地址。请点击下面的链接确认：',
          link,
          '',
          `该链接${params.expiresIn ? ` ${params.expiresIn}内有效` : '在有效期内可用'}，且只能使用一次。`,
          '在你确认之前，当前地址继续有效。',
          ...SUPPORT_TAIL['zh-CN'](appName),
        ],
      }
    case 'email-change-notice':
      return {
        subject: `你的 ${appName} 账号收到更换邮箱申请`,
        lines: [
          `${name}，你好：`,
          '',
          `有人申请把 ${appName} 账号迁移到另一个邮箱地址。`,
          '只有新地址完成确认后改动才会生效。在此之前当前地址一直有效。',
          '',
          '如果不是你本人的操作，请立即修改口令并联系管理员。',
        ],
      }
    case 'email-changed':
      return {
        subject: `你的 ${appName} 邮箱地址已更换`,
        lines: [
          `${name}，你好：`,
          '',
          '你的账号邮箱地址已更换并完成确认。',
          '出于安全考虑，其他已登录的设备已被全部退出。',
          '',
          '如果不是你本人的操作，请立即联系管理员。',
        ],
      }
    case 'invite':
      return {
        subject: `邀请你加入 ${appName}`,
        cta: '创建账号',
        lines: [
          `${name}，你好：`,
          '',
          `你收到了一封邀请，可以创建 ${appName} 账号。`,
          `一次性邀请码：${params.code ?? ''}`,
          link,
          '',
          '该邀请码只能使用一次，且只在本邮件中出现。',
        ],
      }
    case 'new-device':
      return {
        subject: `你的 ${appName} 账号在新设备登录`,
        lines: [
          `${name}，你好：`,
          '',
          '有一台新设备登录了你的账号：',
          `设备：${params.deviceName || '未知'}`,
          `平台：${params.platform || '未知'}`,
          `客户端版本：${params.appVersion || '未知'}`,
          '',
          '如果是你本人，无需处理。否则请修改口令，并在账号中心退出该设备。',
        ],
      }
    case 'password-changed':
      return {
        subject: `你的 ${appName} 账号口令已修改`,
        lines: [
          `${name}，你好：`,
          '',
          '你的账号口令刚刚被修改。',
          '如果是你本人，无需处理。否则请立即重置口令并联系管理员。',
        ],
      }
    case 'deletion-confirm':
      return {
        subject: `确认注销你的 ${appName} 账号`,
        cta: '确认注销',
        lines: [
          `${name}，你好：`,
          '',
          '你申请注销账号。请点击下面的链接确认：',
          link,
          '',
          `该链接${params.expiresIn ? ` ${params.expiresIn}内有效` : '在有效期内可用'}，且只能使用一次。`,
          '确认后仍有冷静期，期间可以取消申请。',
          '如果不是你本人的操作，请忽略本邮件——没有这次确认什么都不会发生。',
        ],
      }
    case 'deletion-scheduled':
      return {
        subject: `你的 ${appName} 账号已排期注销`,
        lines: [
          `${name}，你好：`,
          '',
          `你的账号已排期注销${params.scheduledFor ? `，执行时间为 ${params.scheduledFor}` : ''}。`,
          '在此之前你仍可登录，并在账号中心取消申请：',
          link,
          '',
          '到期后账号将被匿名化，该操作不可撤销。',
        ],
      }
    case 'deletion-cancelled':
      return {
        subject: `你的 ${appName} 账号注销已取消`,
        lines: [
          `${name}，你好：`,
          '',
          '你的账号注销申请已取消。数据没有被删除，账号可以正常使用。',
        ],
      }
    case 'deletion-completed':
      return {
        subject: `你的 ${appName} 账号已注销`,
        lines: [
          `${name}，你好：`,
          '',
          '你申请注销的账号已经完成注销。',
          '该账号无法再登录，个人数据已移除；按合规要求必须保留的审计记录以匿名形式保存。',
          '',
          '感谢你使用 Ecliptrix。',
        ],
      }
  }
}

/** Escape the five characters that can break out of an HTML text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SUBJECT_MAX = 120

/**
 * Render one template.
 *
 * @throws {Error} when the template key is unknown — a typo in a caller must be a
 *         loud failure, not a blank mail.
 */
export function renderMail(
  template: MailTemplateKey,
  params: MailParams,
  locale: Locale = 'zh-CN',
): RenderedMail {
  if (!MAIL_TEMPLATES.includes(template)) {
    throw new Error(`unknown mail template: ${template}`)
  }
  const body = bodyFor(template, params, locale)
  const subject = body.subject.slice(0, SUBJECT_MAX)
  const text = body.lines.join('\n')
  const paragraphs = body.lines
    .filter((line) => line !== '')
    .map((line) => {
      if (line === params.link && params.link) {
        return `<p style="margin:0 0 16px"><a href="${escapeHtml(line)}" style="display:inline-block;background:#3ecf8e;color:#06231a;font-size:13px;font-weight:600;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(body.cta ?? line)}</a></p>`
      }
      return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#9a9a9e">${escapeHtml(line)}</p>`
    })
    .join('\n')

  return {
    subject,
    text,
    html: `<!doctype html><html><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0b0b0c;color:#ededed;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#121214;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:28px">
<h1 style="font-size:16px;margin:0 0 16px">${escapeHtml(subject)}</h1>
${paragraphs}
</div>
</body></html>`,
  }
}
