'use strict'

// Error vocabulary shared by the identity kernel (spec §2.4.4 / §4.4).
//
// Two families live here on purpose:
//   * SERVER_CODE  — `error_code` values the account server can return;
//   * LOCAL_CODE   — failures the desktop main process synthesizes itself
//                    (network, timeouts, and the gate's own states).
// Both end up in `{ ok:false, code }` over IPC, so a renderer switches on one
// string space. Pure constants and pure functions: no electron, no IO.

const SERVER_CODE = {
  INVALID_REQUEST: 'invalid_request',
  VALIDATION_FAILED: 'validation_failed',
  UNAUTHORIZED: 'unauthorized',
  INVALID_CREDENTIALS: 'invalid_credentials',
  SESSION_EXPIRED: 'session_expired',
  SESSION_REVOKED: 'session_revoked',
  PASSWORD_CHANGE_REQUIRED: 'password_change_required',
  FORBIDDEN: 'forbidden',
  ACCOUNT_SUSPENDED: 'account_suspended',
  ACCOUNT_LOCKED: 'account_locked',
  REGISTRATION_DISABLED: 'registration_disabled',
  INVITE_REQUIRED: 'invite_required',
  INVITE_INVALID: 'invite_invalid',
  INVITE_EXHAUSTED: 'invite_exhausted',
  EMAIL_TAKEN: 'email_taken',
  USERNAME_TAKEN: 'username_taken',
  WEAK_PASSWORD: 'weak_password',
  PASSWORD_MISMATCH: 'password_mismatch',
  RATE_LIMITED: 'rate_limited',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  INTERNAL_ERROR: 'internal_error',
  CLIENT_OUTDATED: 'client_outdated',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  CSRF_FAILED: 'csrf_failed',
  // Added with the account-lifecycle release (migration 0005).
  EMAIL_NOT_VERIFIED: 'email_not_verified',
  EMAIL_ALREADY_VERIFIED: 'email_already_verified',
  TOKEN_INVALID: 'token_invalid',
  DELETION_PENDING: 'deletion_pending',
  MAIL_DISABLED: 'mail_disabled',
}

const LOCAL_CODE = {
  NETWORK_UNREACHABLE: 'network_unreachable',
  REQUEST_TIMEOUT: 'request_timeout',
  GRACE_EXPIRED: 'grace_expired',
  BRIDGE_UNAVAILABLE: 'bridge_unavailable',
  SERVER_NOT_CONFIGURED: 'server_not_configured',
  GATE_DISABLED: 'gate_disabled',
  SESSION_CORRUPT: 'session_corrupt',
}

// `code` → UI reason (spec §4.4 "主进程 reason"). Server codes use the
// kebab-case vocabulary of `AuthReason`; synthesized network codes stay
// snake_case because that is the spelling §4.4 fixes for them.
const UI_REASON_BY_CODE = {
  [SERVER_CODE.INVALID_CREDENTIALS]: 'invalid-credentials',
  [SERVER_CODE.ACCOUNT_LOCKED]: 'account-locked',
  [SERVER_CODE.ACCOUNT_SUSPENDED]: 'account-suspended',
  [SERVER_CODE.RATE_LIMITED]: 'rate-limited',
  [SERVER_CODE.SESSION_REVOKED]: 'session-revoked',
  [SERVER_CODE.SESSION_EXPIRED]: 'session-expired',
  [SERVER_CODE.UNAUTHORIZED]: 'session-revoked',
  [SERVER_CODE.PASSWORD_CHANGE_REQUIRED]: 'password-change-required',
  [SERVER_CODE.CLIENT_OUTDATED]: 'client-outdated',
  [SERVER_CODE.WEAK_PASSWORD]: 'weak-password',
  [SERVER_CODE.VALIDATION_FAILED]: 'validation-failed',
  [SERVER_CODE.INTERNAL_ERROR]: 'internal-error',
  [SERVER_CODE.PASSWORD_MISMATCH]: 'password-mismatch',
  [SERVER_CODE.REGISTRATION_DISABLED]: 'registration-disabled',
  // `email_not_verified` is a policy refusal, not a credential failure: the
  // renderer shows "go verify your address", never the generic wrong-password copy.
  [SERVER_CODE.EMAIL_NOT_VERIFIED]: 'email-unverified',
  [SERVER_CODE.EMAIL_ALREADY_VERIFIED]: 'email-unverified',
  [SERVER_CODE.TOKEN_INVALID]: 'validation-failed',
  [SERVER_CODE.DELETION_PENDING]: 'deletion-pending',
  [SERVER_CODE.MAIL_DISABLED]: 'mail-disabled',
  [LOCAL_CODE.NETWORK_UNREACHABLE]: 'network',
  [LOCAL_CODE.REQUEST_TIMEOUT]: 'network',
  [LOCAL_CODE.GRACE_EXPIRED]: 'grace-expired',
  [LOCAL_CODE.BRIDGE_UNAVAILABLE]: 'bridge-unavailable',
  [LOCAL_CODE.SERVER_NOT_CONFIGURED]: 'server-not-configured',
  [LOCAL_CODE.GATE_DISABLED]: 'gate-disabled',
  [LOCAL_CODE.SESSION_CORRUPT]: 'no-session',
}

// Codes where a retry can plausibly succeed (spec §4.4 last column).
const RETRYABLE = new Set([
  SERVER_CODE.INVALID_CREDENTIALS,
  SERVER_CODE.ACCOUNT_LOCKED,
  SERVER_CODE.RATE_LIMITED,
  SERVER_CODE.SESSION_REVOKED,
  SERVER_CODE.SESSION_EXPIRED,
  SERVER_CODE.WEAK_PASSWORD,
  SERVER_CODE.VALIDATION_FAILED,
  SERVER_CODE.EMAIL_TAKEN,
  SERVER_CODE.USERNAME_TAKEN,
  SERVER_CODE.INVITE_REQUIRED,
  SERVER_CODE.INVITE_INVALID,
  SERVER_CODE.PASSWORD_MISMATCH,
  SERVER_CODE.INTERNAL_ERROR,
  SERVER_CODE.SERVICE_UNAVAILABLE,
  LOCAL_CODE.NETWORK_UNREACHABLE,
  LOCAL_CODE.REQUEST_TIMEOUT,
  LOCAL_CODE.GRACE_EXPIRED,
  'local_admin_locked',
])

/**
 * The single error type the account client throws and the controller catches.
 *
 * The controller never lets one of these escape an IPC handler: it converts
 * them into `{ ok:false, code, message, details?, requestId? }` (spec §4.1).
 */
class AccountError extends Error {
  /**
   * @param {string} code Server `error_code` or a `LOCAL_CODE` value.
   * @param {object} [options]
   * @param {number} [options.status] HTTP status, 0 for transport failures.
   * @param {string} [options.message] Human-readable fallback text.
   * @param {unknown} [options.details] Server `error_details`.
   * @param {string} [options.requestId] `X-Request-Id` for support tickets.
   */
  constructor(code, options = {}) {
    super(options.message || code)
    this.name = 'AccountError'
    this.code = code
    this.status = options.status === undefined ? 0 : options.status
    this.details = options.details
    this.requestId = options.requestId
  }

  /** Serialise into the IPC failure shape (§4.1). */
  toFailure() {
    const failure = {
      ok: false,
      code: this.code,
      message: this.message,
      reason: toUiReason(this.code, this.details),
    }
    if (this.details !== undefined) failure.details = this.details
    if (this.requestId) failure.requestId = this.requestId
    return failure
  }
}

/**
 * Map a main-process `code` onto the renderer's reason vocabulary.
 *
 * @param {string} code Server or local error code.
 * @param {unknown} [details] Server `error_details`, used to split the two
 *   meanings of `service_unavailable` (maintenance vs. plain outage).
 * @returns {string} A reason from the `AuthReason` union. Unknown codes fall
 *   back to `internal-error` so the field can never leave that union.
 */
function toUiReason(code, details) {
  if (code === SERVER_CODE.SERVICE_UNAVAILABLE) {
    const reason = details && typeof details === 'object' ? details.reason : undefined
    return reason === 'maintenance' ? 'maintenance' : 'network'
  }
  return UI_REASON_BY_CODE[code] || 'internal-error'
}

/** @param {string} code @returns {boolean} Whether a manual retry can help. */
function isRetryable(code) {
  return RETRYABLE.has(code)
}

module.exports = {
  SERVER_CODE,
  LOCAL_CODE,
  ERROR_CODE: { ...SERVER_CODE, ...LOCAL_CODE },
  UI_REASON_BY_CODE,
  RETRYABLE,
  AccountError,
  toUiReason,
  isRetryable,
}
