import { ERROR_CODE, type ErrorCode } from '@/server/auth/constants'

/**
 * The one error type services throw.
 *
 * A service never knows about HTTP status codes: it raises the domain failure
 * (`email_taken`) and `ERROR_STATUS` maps it. That keeps the mapping in one
 * table, which is what makes `docs/api.md` and the client's error switch
 * trustworthy.
 */
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly status: number
  public readonly details?: Record<string, unknown>
  /** Seconds until the caller may retry; only meaningful for 423 / 429. */
  public readonly retryAfterSeconds?: number

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      status?: number
      details?: Record<string, unknown>
      retryAfterSeconds?: number
    } = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = options.status ?? ERROR_STATUS[code] ?? 500
    this.details = options.details
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  invalid_credentials: 401,
  session_expired: 401,
  session_revoked: 401,
  password_change_required: 403,
  forbidden: 403,
  account_suspended: 403,
  account_locked: 423,
  client_outdated: 426,
  registration_disabled: 403,
  invite_required: 403,
  invite_invalid: 403,
  invite_exhausted: 409,
  email_taken: 409,
  username_taken: 409,
  weak_password: 422,
  password_mismatch: 401,
  cannot_modify_owner: 409,
  cannot_modify_self: 409,
  role_in_use: 409,
  system_role_protected: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  csrf_failed: 403,
  payload_too_large: 413,
  service_unavailable: 503,
  internal_error: 500,
  email_not_verified: 403,
  email_already_verified: 409,
  token_invalid: 400,
  deletion_pending: 409,
  mail_disabled: 503,
}

/** Shorthands for the failures raised more than once. */
export const errors = {
  unauthorized: (message = '需要登录') => new AppError(ERROR_CODE.unauthorized, message),
  forbidden: (message = '权限不足') => new AppError(ERROR_CODE.forbidden, message),
  notFound: (message = '资源不存在') => new AppError(ERROR_CODE.notFound, message),
  conflict: (message = '状态冲突') => new AppError(ERROR_CODE.conflict, message),
  csrf: () => new AppError(ERROR_CODE.csrfFailed, 'CSRF 校验失败，请刷新页面后重试'),
  invalidCredentials: () =>
    new AppError(ERROR_CODE.invalidCredentials, '邮箱或口令不正确'),
  rateLimited: (retryAfterSeconds: number, message = '请求过于频繁，请稍后再试') =>
    new AppError(ERROR_CODE.rateLimited, message, {
      details: { retryAfterSeconds },
      retryAfterSeconds,
    }),
  /**
   * The client build is below `client.minVersion` (HTTP 426, Upgrade Required).
   *
   * `minVersion` travels in `details` so the client can say "update to x.y.z"
   * instead of "update", and so support can tell a real gate from a network
   * failure. Never raised by heartbeat/refresh/logout — see `authService.login`.
   */
  clientOutdated: (minVersion: string) =>
    new AppError(ERROR_CODE.clientOutdated, `客户端版本过低，请升级到 ${minVersion} 或更高版本`, {
      details: { minVersion },
    }),
  /**
   * A mailed link that cannot be honoured. One code for unknown/expired/used/
   * wrong-purpose: the caller must not learn which (spec §5.1).
   */
  tokenInvalid: (message = '链接无效或已过期') => new AppError(ERROR_CODE.tokenInvalid, message),
  /** The action needs mail and this deployment has no SMTP. */
  mailDisabled: () =>
    new AppError(ERROR_CODE.mailDisabled, '当前部署未配置邮件服务，无法发送邮件', {
      details: { reason: 'mail_disabled' },
    }),
} as const

/** Narrow an unknown throwable to AppError. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}
