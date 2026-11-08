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

export const loginSchema = z.object({
  identifier: identifierSchema,
  password: passwordSchema,
  client: clientSchema.default('web'),
  clientVersion: clientVersionSchema,
  device: deviceSchema,
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

export const createInviteSchema = z.object({
  maxUses: z.number().int().min(1, '至少 1 次').max(1000).default(1),
  expiresInDays: z.number().int().min(0).max(365).default(14),
  roleKey: z.string().trim().min(1).max(40).default('member'),
})

export const settingsPatchSchema = z.record(z.string(), z.union([z.boolean(), z.number(), z.string()]))

export const localeCookieSchema = z.enum(['zh-CN', 'en-US'])

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
