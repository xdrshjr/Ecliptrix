import { z } from 'zod'
import { LOCALE_COOKIE } from '@/server/auth/constants'

/**
 * Request schemas. Every route validates exactly once, here, and then hands the
 * parsed value to a service — services never re-validate (CLAUDE.md §5).
 */

export const identifierSchema = z
  .string()
  .trim()
  .min(3, '标识至少 3 个字符')
  .max(254, '标识过长')

export const emailSchema = z
  .string()
  .trim()
  .min(3, '请输入邮箱')
  .max(254, '邮箱过长')
  .email('邮箱格式不正确')

export const usernameSchema = z
  .string()
  .trim()
  .min(3, '用户名至少 3 个字符')
  .max(32, '用户名最多 32 个字符')
  .regex(/^[a-zA-Z0-9_.-]+$/, '用户名只能包含字母、数字、下划线、点和连字符')

export const passwordSchema = z.string().min(1, '请输入口令').max(200, '口令过长')

export const displayNameSchema = z.string().trim().min(1, '请输入显示名').max(40, '显示名最多 40 个字符')

export const clientSchema = z.enum(['web', 'desktop'])

export const deviceSchema = z
  .object({
    name: z.string().trim().max(80).default(''),
    platform: z.string().trim().max(60).default(''),
    appVersion: z.string().trim().max(40).default(''),
    /**
     * Stable per-machine fingerprint from `deriveDeviceKey()` — not a random id,
     * so a reinstall keeps it and a re-login replaces the earlier session instead
     * of consuming another slot of the per-user cap.
     *
     * The shape is `[A-Za-z0-9_-]{8,64}`, with the empty string meaning "this
     * caller has no device identity" (browser, old build). The allowance is an
     * explicit `refine` rather than a `.?` in the regex because zod 3.25
     * validates the value produced by `.default('')`: a bare
     * `.regex(/^[A-Za-z0-9_-]{8,64}$/).default('')` rejects its own default.
     */
    deviceKey: z
      .string()
      .trim()
      .max(64)
      .refine(
        (value) => value === '' || /^[A-Za-z0-9_-]{8,64}$/.test(value),
        '设备标识格式不正确',
      )
      .default(''),
  })
  .default({ name: '', platform: '', appVersion: '', deviceKey: '' })

/** Desktop build string, e.g. `1.0.1`. Empty for the browser. */
export const clientVersionSchema = z.string().trim().max(40).default('')

/* ------------------------------------------------------------------ *
 * Human verification (migration 0007)
 * ------------------------------------------------------------------ */

/** Challenge id — a UUID, but validated as a bounded string so a future id
 *  scheme does not need a second schema change. */
export const captchaIdSchema = z.string().trim().min(8, '验证码标识无效').max(64)

/** What the user typed. Length is generous: normalisation (whitespace, case)
 *  happens in the service, and rejecting at the boundary would turn a
 *  human typo ("K7 QX2") into a `validation_failed` instead of a retry hint. */
export const captchaAnswerSchema = z.string().trim().min(1, '请输入验证码').max(32)

export const captchaPurposeSchema = z.enum(['register', 'login'])

export const captchaQuerySchema = z.object({
  purpose: captchaPurposeSchema.default('register'),
})


export const loginSchema = z.object({
  identifier: identifierSchema,
  password: passwordSchema,
  client: clientSchema.default('web'),
  clientVersion: clientVersionSchema,
  device: deviceSchema,
  /**
   * Human verification, optional HERE on purpose.
   *
   * If these were required, a missing field would be a `ZodError` →
   * `validation_failed` (422) before the service ever runs, and the contract
   * `400 captcha_required` would be unreachable (spec §4.2 note, review R-04).
   * The schema only says "if present, it is a string"; the service decides
   * whether the operation needs one.
   */
  captchaId: captchaIdSchema.optional(),
  captchaAnswer: captchaAnswerSchema.optional(),
})

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
  inviteCode: z.string().trim().max(64).optional(),
  client: clientSchema.default('web'),
  clientVersion: clientVersionSchema,
  device: deviceSchema,
  // Optional for the same reason as `loginSchema` — see the note there.
  captchaId: captchaIdSchema.optional(),
  captchaAnswer: captchaAnswerSchema.optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
  signOutOtherSessions: z.boolean().default(false),
})

export const resetRequestSchema = z.object({
  email: emailSchema,
})

export const resetConfirmSchema = z.object({
  token: z.string().trim().min(16, '重置令牌无效').max(200),
  newPassword: passwordSchema,
})

export const refreshSchema = z.object({
  refreshToken: z.string().trim().min(16).max(200).optional(),
})

export const profilePatchSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarUrl: z.string().trim().url('头像必须是合法 URL').max(500).nullable().optional(),
    locale: z.enum(['zh-CN', 'en-US']).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict('该字段不允许由本人修改')

export const userStatusSchema = z.enum(['active', 'suspended', 'pending', 'deleted'])
export const planTagSchema = z.enum(['free', 'pro', 'studio'])

export const createUserSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  displayName: displayNameSchema.optional(),
  password: passwordSchema.optional(),
  roleId: z.string().uuid('角色 ID 无效').optional(),
  roleKey: z.string().trim().min(1).max(40).optional(),
  status: userStatusSchema.default('active'),
  planTag: planTagSchema.default('free'),
  note: z.string().trim().max(500).default(''),
  mustChangePassword: z.boolean().default(true),
})

export const updateUserSchema = z
  .object({
    email: emailSchema.optional(),
    username: usernameSchema.optional(),
    displayName: displayNameSchema.optional(),
    roleId: z.string().uuid('角色 ID 无效').optional(),
    status: userStatusSchema.optional(),
    planTag: planTagSchema.optional(),
    note: z.string().trim().max(500).optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '没有需要更新的字段')

export const bulkActionSchema = z
  .object({
    action: z.enum(['suspend', 'activate', 'delete', 'restore', 'setRole']),
    ids: z.array(z.string().uuid()).min(1, '至少选择一位用户').max(200, '单次最多 200 位'),
    roleId: z.string().uuid().optional(),
  })
  .refine((value) => value.action !== 'setRole' || Boolean(value.roleId), {
    message: 'setRole 必须提供 roleId',
    path: ['roleId'],
  })

export const passwordResetModeSchema = z.object({
  mode: z.enum(['temp_password', 'reset_link']).default('temp_password'),
})

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, '至少 2 个字符')
    .max(40, '最多 40 个字符')
    .regex(/^[a-z][a-z0-9_-]*$/, '角色标识只能使用小写字母、数字、下划线和连字符'),
  name: z.string().trim().min(1, '请输入角色名称').max(40),
  description: z.string().trim().max(200).default(''),
})

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    description: z.string().trim().max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '没有需要更新的字段')

export const permissionsSchema = z.object({
  permissions: z.array(z.string().min(1).max(40)).max(200),
})

export const settingsPatchSchema = z.record(z.string(), z.union([z.boolean(), z.number(), z.string()]))

/* ------------------------------------------------------------------ *
 * Account lifecycle (migration 0005)
 * ------------------------------------------------------------------ */

/** A mailed one-time token. Base64url, 32 bytes → 43 characters. */
export const emailTokenSchema = z.string().trim().min(16, '链接无效').max(200)

export const emailVerifySchema = z.object({
  token: emailTokenSchema,
})

export const emailChangeSchema = z.object({
  password: passwordSchema,
  newEmail: emailSchema,
})

export const deletionRequestSchema = z
  .object({
    password: passwordSchema,
    /** Why the account is going away — shown to administrators, never mailed. */
    reason: z.string().trim().max(200).optional(),
  })
  .default({ password: '' })

export const deletionConfirmSchema = z.object({
  token: emailTokenSchema,
})

export const adminSessionsQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  client: z.enum(['web', 'desktop']).optional(),
  platform: z.string().trim().max(60).optional(),
  activeOnly: z.union([z.literal('0'), z.literal('1')]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().trim().max(40).optional(),
})

export const adminSessionsRevokeSchema = z.object({
  // The 100-item cap is also enforced in the repository; here it becomes a 422
  // with a clear message instead of a silent truncation.
  ids: z
    .array(z.string().trim().min(4).max(64))
    .min(1, '至少选择一个会话')
    .max(100, '单次最多吊销 100 个会话'),
  reason: z.enum(['admin_revoke', 'admin_lockdown', 'security_incident']).optional(),
})

export const adminMailQuerySchema = z.object({
  status: z.enum(['captured', 'sent', 'failed']).optional(),
  template: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

/** Admin on-behalf deletion confirmation (P1-11). */
export const adminDeletionConfirmSchema = z.object({
  reason: z.string().trim().min(3, '请填写处理原因').max(200),
})

export const userExportQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'suspended', 'pending', 'deleted']).optional(),
  role: z.string().trim().max(40).optional(),
  plan: z.enum(['free', 'pro', 'studio']).optional(),
})

export const metricsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).optional(),
})

export const inviteCreateSchema = z.object({
  maxUses: z.number().int().min(1, '至少 1 次').max(1000).default(1),
  expiresInDays: z.number().int().min(0).max(365).default(14),
  roleKey: z.string().trim().min(1).max(40).default('member'),
  /** Optional: when present the invite is mailed instead of only returned. */
  email: emailSchema.optional(),
  note: z.string().trim().max(200).optional(),
})

/**
 * Upload metadata for `POST /api/v1/admin/releases`.
 *
 * It travels in the query string, not in a multipart body: `request.formData()`
 * buffers the whole file in memory, and an installer is ~188 MB. The body is the
 * raw bytes (streamed), the metadata is everything else.
 *
 * Every field here is short ON PURPOSE. Release notes are NOT accepted: they cap
 * at 2000 characters, which URL-encoded (9 bytes per CJK character) is far past
 * nginx's 8 KB header buffer — the upload would answer 414 before it started. Notes
 * are set with `PATCH {action:'notes'}` once the draft exists, which is also where
 * the console edits them anyway.
 */
export const releaseUploadQuerySchema = z.object({
  version: z.string().trim().min(1, '请填写版本号').max(20),
  platform: z.string().trim().min(1, '请选择平台').max(16),
  arch: z.string().trim().min(1, '请选择架构').max(16),
  fileName: z.string().trim().min(1, '请提供文件名').max(160),
  /** Optional pre-computed checksum from the build script; verified when present. */
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, '校验和必须是 64 位十六进制 SHA-256')
    .optional(),
})

/** One pointer action on an existing release. */
export const releaseActionSchema = z
  .object({
    action: z.enum(['publish', 'rollback', 'retract', 'notes']),
    /** Defaults to `stable`; the console only offers channels it knows. */
    channel: z.string().trim().max(16).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((value) => value.action !== 'notes' || value.notes !== undefined, {
    message: '修改说明时必须提供 notes',
    path: ['notes'],
  })

export const releaseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

export const localeCookieSchema = z.enum(['zh-CN', 'en-US'])

/** Kept for the existing import sites; the invitation body gained two fields. */
export const createInviteSchema = inviteCreateSchema

export const LOCALE_COOKIE_NAME = LOCALE_COOKIE

/**
 * Turn a zod failure into the `details.fields` shape the console renders under
 * each input. Keeping the key path as a dotted string means the client does not
 * have to walk arrays.
 */
export function fieldErrors(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '_',
    message: issue.message,
  }))
}
