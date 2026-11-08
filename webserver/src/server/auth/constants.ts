/**
 * Single source of truth for cookie names, token lifetimes and revocation
 * reasons. Nothing else in the codebase may hard-code these strings — a typo
 * in a cookie name is a silent logout loop, not a type error.
 */

export const SESSION_COOKIE = 'ecs_session'
export const REFRESH_COOKIE = 'ecs_refresh'
export const CSRF_COOKIE = 'ecs_csrf'
export const CSRF_HEADER = 'x-csrf-token'
export const REQUEST_ID_HEADER = 'x-request-id'
export const LOCALE_COOKIE = 'ecs_lang'

/** Web cookies are app-wide; the refresh cookie is scoped to the auth API. */
export const SESSION_COOKIE_PATH = '/'
export const REFRESH_COOKIE_PATH = '/api/v1/auth'

export const REVOKE_REASON = {
  logout: 'logout',
  suspended: 'suspended',
  adminRevoked: 'admin_revoked',
  refreshReuse: 'refresh_reuse',
  passwordChanged: 'password_changed',
  sessionLimit: 'session_limit',
  deleted: 'deleted',
  /**
   * The same machine signed in again. The previous session of that device is
   * retired so a reinstall does not burn a slot of the per-user session budget.
   */
  sameDeviceRelogin: 'same_device_relogin',
} as const

export type RevokeReason = (typeof REVOKE_REASON)[keyof typeof REVOKE_REASON]

/** Error codes are API: renaming one is a breaking change (spec §4.4). */
export const ERROR_CODE = {
  invalidRequest: 'invalid_request',
  validationFailed: 'validation_failed',
  unauthorized: 'unauthorized',
  invalidCredentials: 'invalid_credentials',
  sessionExpired: 'session_expired',
  sessionRevoked: 'session_revoked',
  passwordChangeRequired: 'password_change_required',
  forbidden: 'forbidden',
  accountSuspended: 'account_suspended',
  accountLocked: 'account_locked',
  /**
   * The desktop build is older than `client.minVersion`. Only login/register
   * ever answer this: a client that cannot present a session must still be able
   * to log out, and a session in flight must still be refreshable.
   */
  clientOutdated: 'client_outdated',
  registrationDisabled: 'registration_disabled',
  inviteRequired: 'invite_required',
  inviteInvalid: 'invite_invalid',
  inviteExhausted: 'invite_exhausted',
  emailTaken: 'email_taken',
  usernameTaken: 'username_taken',
  weakPassword: 'weak_password',
  passwordMismatch: 'password_mismatch',
  cannotModifyOwner: 'cannot_modify_owner',
  cannotModifySelf: 'cannot_modify_self',
  roleInUse: 'role_in_use',
  systemRoleProtected: 'system_role_protected',
  notFound: 'not_found',
  conflict: 'conflict',
  rateLimited: 'rate_limited',
  csrfFailed: 'csrf_failed',
  payloadTooLarge: 'payload_too_large',
  serviceUnavailable: 'service_unavailable',
  internalError: 'internal_error',
} as const

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]

/** Proxy/session housekeeping. */
/**
 * Fallback for `security.maxActiveSessions`, which is the live value.
 *
 * The constant stays because the settings table can be empty on a fresh database
 * and `settingsService` needs a default that does not come from the environment.
 */
export const DEFAULT_MAX_ACTIVE_SESSIONS = 10
export const HEARTBEAT_TOUCH_INTERVAL_MS = 5 * 60 * 1000

/**
 * The role that owns the installation.
 *
 * Lives here rather than in `userService` because the guards need it too, and a
 * constant both layers share must not create a service→guard import cycle.
 */
export const OWNER_ROLE_KEY = 'owner'
