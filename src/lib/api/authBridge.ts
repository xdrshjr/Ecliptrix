/**
 * Renderer-side mirror of the desktop auth IPC contract
 * (spec `docs/plans/desktop-account-login-gate/spec.md` §4.1).
 *
 * The single source of truth for every field below is the **main process**
 * (`desktop/main/authController.js` + `desktop/main/authBridge.js`); this file
 * only mirrors it and wraps `window.ecliptrixDesktop.auth`. Changing one side
 * without the other is a contract break.
 *
 * The wrappers are deliberately thin: they never swallow a rejection and they
 * never fabricate state. `{ ok:false, code, … }` envelopes (the documented
 * failure shape — `ipcMain.handle` rejections would lose `code`) are re-thrown
 * as-is so callers can `catch (error)` and branch on `error.code`.
 *
 * No network call happens here. Every account-server request is made by the
 * main process: AC-04 / AC-05 in the spec depend on the renderer having no
 * credential or server URL of its own.
 */

/** Lifecycle of the desktop identity gate. `booting` is cold-start only. */
export type AuthState = 'booting' | 'unauthenticated' | 'authenticated' | 'blocked';

/** How the current identity was established. */
export type AuthSource = 'server' | 'offline-cache' | 'local-root' | 'gate-disabled';

/** Why the renderer is showing a login screen / blocker instead of the app. */
export type AuthReason =
  | 'no-session'
  | 'session-expired'
  | 'session-revoked'
  | 'account-suspended'
  | 'account-locked'
  | 'password-change-required'
  | 'grace-expired'
  | 'clock-rollback'
  | 'network'
  | 'client-outdated'
  | 'maintenance'
  | 'bridge-unavailable'
  | 'server-not-configured'
  | 'gate-disabled'
  // Produced by `toUiReason()` for a *failure* (desktop/main/authErrors.js) rather
  // than for a gate state: these are the codes a form shows verbatim.
  | 'invalid-credentials'
  | 'rate-limited'
  | 'weak-password'
  | 'validation-failed'
  | 'password-mismatch'
  | 'registration-disabled'
  | 'internal-error'
  // Added with the account-lifecycle release.
  | 'email-unverified'
  | 'account-deleted'
  | 'deletion-pending'
  | 'mail-disabled';

/** Public server metadata mirrored from `GET /api/v1/meta`. */
export interface ServerMeta {
  registrationEnabled: boolean;
  inviteRequired: boolean;
  smtpEnabled: boolean;
  passwordPolicy: { minLength: number; maxBytes: number };
  appName: string;
  supportEmail: string;
  version: string;
  /** `''` means "no minimum". */
  minClientVersion: string;
  /** `''` means "not in maintenance". */
  maintenanceMessage: string;
  maxActiveSessions: number;
  /**
   * True when this deployment refuses an unverified desktop login. The login
   * screen uses it to explain a 403 `email_not_verified` instead of showing a
   * generic failure.
   */
  emailVerificationRequired: boolean;
  /**
   * The runtime origin of the account server this session talks to.
   *
   * `''` means "unknown" (the main process never reached it). "Open the account
   * centre in a browser" prefers this over the build-time constant so a
   * self-hosted deployment never sends its users to another company's site.
   */
  baseUrl: string;
}

/** The signed-in account as the main process last saw it. */
export interface SessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  planTag: string;
  mustChangePassword: boolean;
  /** False = the address has not been proven; the account centre shows a banner. */
  emailVerified: boolean;
  role: { key: string; name: string };
  permissions: string[];
}

/**
 * The caller's own record, as `/me` returns it (through `auth:me`).
 *
 * `pendingEmail` is already MASKED by the server: an address that is not yet
 * confirmed must not be displayed as if it were the current one.
 */
export interface MeView {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  username: string;
  locale: 'zh-CN' | 'en-US';
  timezone: string;
  role: { key: string; name: string };
  planTag: string;
  createdAt: string;
  lastLoginAt: string | null;
  pendingEmail: string | null;
  deletion: { status: 'awaiting_confirmation' | 'scheduled'; scheduledFor: string | null } | null;
}

/**
 * One row of the activity timeline.
 *
 * `ipMasked` — the main process masks the address before it crosses into the
 * renderer, so a full IP is never available here to be logged or reported.
 */
export interface ActivityItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  ipMasked: string;
  createdAt: string;
}

export interface ActivityResult {
  items: ActivityItem[];
  /** "There are more rows" — not "the server truncated the list". */
  truncated: boolean;
}

export interface UpdateProfilePayload {
  displayName?: string;
  locale?: 'zh-CN' | 'en-US';
  timezone?: string;
}

/**
 * Which of the account-centre capabilities this main process actually provides.
 *
 * Per METHOD, not per bridge: an older main process ships the bridge but not these
 * four methods, and calling one would throw inside the renderer. Everything the
 * dialog offers is gated on this probe.
 */
export interface AuthBridgeCapabilities {
  me: boolean;
  updateProfile: boolean;
  activity: boolean;
  resendVerification: boolean;
}

/** Probe the four capabilities without calling anything. */
export function probeAuthCapabilities(bridge: AuthBridge | null): AuthBridgeCapabilities {
  return {
    me: typeof bridge?.me === 'function',
    updateProfile: typeof bridge?.updateProfile === 'function',
    activity: typeof bridge?.activity === 'function',
    resendVerification: typeof bridge?.resendVerification === 'function',
  };
}

/** One row of `GET /me/sessions`, re-shaped by the main process. */
export interface SessionInfo {
  id: string;
  client: 'web' | 'desktop';
  deviceName: string;
  platform: string;
  appVersion: string;
  /** Server-side device identity; `''` for web sessions. */
  deviceKey: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

/** Full identity snapshot. Never contains `accessToken` / `refreshToken`. */
export interface AuthStatus {
  state: AuthState;
  source: AuthSource | null;
  reason: AuthReason | null;
  user: SessionUser | null;
  sessionId: string | null;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  graceUntil: string | null;
  mustChangePassword: boolean;
  appVersion: string;
  server: ServerMeta | null;
  reachable: boolean;
  lockedUntil: string | null;
  attemptsLeft: number | null;
  securityWarning: 'plaintext-session' | 'local-default-password' | 'gate-disabled' | null;
}

export interface LoginPayload {
  identifier: string;
  password: string;
  rememberDevice?: boolean;
}

export interface LocalLoginPayload {
  username: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  username?: string;
  displayName?: string;
  inviteCode?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
  signOutOtherSessions?: boolean;
}

/** Documented failure envelope (§4.1). Returned, never thrown over IPC. */
export interface AuthFailure {
  ok: false;
  code: string;
  message: string;
  /** `toUiReason(code, details)` — the main process always fills this in. */
  reason?: AuthReason;
  details?: unknown;
  requestId?: string;
}

export interface SessionListResult {
  ok: true;
  items: SessionInfo[];
  currentId: string;
}

/** The preload channel. `window.ecliptrixDesktop.auth` is this object. */
export interface AuthBridge {
  status(): Promise<AuthStatus>;
  login(p: LoginPayload): Promise<AuthStatus>;
  loginLocal(p: LocalLoginPayload): Promise<AuthStatus>;
  logout(): Promise<AuthStatus>;
  register(p: RegisterPayload): Promise<AuthStatus>;
  changePassword(p: ChangePasswordPayload): Promise<AuthStatus>;
  requestPasswordReset(p: { email: string }): Promise<{ ok: true }>;
  listSessions(): Promise<SessionListResult>;
  revokeSession(id: string): Promise<{ ok: true }>;
  openExternal(url: string): Promise<{ ok: true }>;
  // Account centre (optional: an older main process has the bridge, not these).
  me?(): Promise<MeView>;
  updateProfile?(payload: UpdateProfilePayload): Promise<MeView>;
  activity?(): Promise<ActivityResult>;
  resendVerification?(): Promise<{ sentAt: string; expiresAt: string }>;
  onChanged(cb: (s: AuthStatus) => void): () => void;
}

/**
 * Resolve the preload auth channel.
 *
 * Returns `null` when the renderer has no bridge at all — either a plain
 * browser (`npm run dev` debugging path) or a packaged build whose preload is
 * missing. Deciding what `null` means is `SessionContext`'s job (dev pass-through
 * vs. fail-closed); this function only reports the fact.
 *
 * The shape comes from `src/types/desktop.d.ts` (which references `AuthBridge`
 * above), so a channel renamed in `desktop/preload/preload.js` has one place to
 * change instead of an `as unknown as` cast hiding the drift.
 */
export function getAuthBridge(): AuthBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.ecliptrixDesktop?.auth;
  if (!bridge || typeof bridge.status !== 'function') return null;
  return bridge;
}

/** Thrown when the preload channel is absent. `code` mirrors the main-process code. */
export class AuthBridgeUnavailableError extends Error {
  readonly code = 'bridge_unavailable';

  constructor() {
    super('Desktop auth bridge is unavailable: window.ecliptrixDesktop.auth is missing.');
    this.name = 'AuthBridgeUnavailableError';
  }
}

/** Thrown when another auth action is still in flight (double-submit guard). */
export class AuthBusyError extends Error {
  readonly code = 'auth_busy';

  constructor() {
    super('Another auth action is already running.');
    this.name = 'AuthBusyError';
  }
}

function requireBridge(): AuthBridge {
  const bridge = getAuthBridge();
  if (!bridge) throw new AuthBridgeUnavailableError();
  return bridge;
}

function unwrapStatus(value: AuthStatus | AuthFailure): AuthStatus {
  if (isAuthFailure(value)) throw value;
  return value;
}

function unwrapOk(value: { ok: true } | AuthFailure): { ok: true } {
  if (isAuthFailure(value)) throw value;
  return value;
}

function unwrapSessions(value: SessionListResult | AuthFailure): SessionListResult {
  if (isAuthFailure(value)) throw value;
  return value;
}

/** Narrow an unknown payload to the failure envelope. */
export function isAuthFailure(value: unknown): value is AuthFailure {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; code?: unknown };
  return candidate.ok === false && typeof candidate.code === 'string';
}

/**
 * Normalise whatever a caller caught into an `AuthFailure`.
 *
 * The bridge contract returns failures, so a rejection means either a missing
 * preload (`bridge_unavailable`) or a contract violation (`internal_error`).
 * The original message is kept: the UI shows its own localized copy anyway.
 */
export function toAuthFailure(error: unknown): AuthFailure {
  if (isAuthFailure(error)) return error;
  if (error instanceof AuthBusyError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof AuthBridgeUnavailableError) {
    // Kept as its own code: the login screen has dedicated copy for "the desktop
    // bridge is missing" (`bridgeUnavailable`), which is a different sentence and
    // a different remedy from a generic internal error.
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { ok: false, code: 'internal_error', message: error.message };
  }
  return { ok: false, code: 'internal_error', message: 'Unknown auth failure' };
}

/** `auth:status` — always answerable, `booting` before the controller settles. */
export async function bridgeStatus(): Promise<AuthStatus> {
  return unwrapStatus(await requireBridge().status());
}

/** `auth:login` (form A: account server). */
export async function bridgeLogin(payload: LoginPayload): Promise<AuthStatus> {
  return unwrapStatus(await requireBridge().login(payload));
}

/** `auth:login-local` (form B: break-glass local admin, no network). */
export async function bridgeLoginLocal(payload: LocalLoginPayload): Promise<AuthStatus> {
  return unwrapStatus(await requireBridge().loginLocal(payload));
}

/** `auth:logout` — a local-root session only clears the in-memory flag. */
export async function bridgeLogout(): Promise<AuthStatus> {
  return unwrapStatus(await requireBridge().logout());
}

/** `auth:register`. */
export async function bridgeRegister(payload: RegisterPayload): Promise<AuthStatus> {
  return unwrapStatus(await requireBridge().register(payload));
}

/** `auth:change-password`. */
export async function bridgeChangePassword(
  payload: ChangePasswordPayload,
): Promise<AuthStatus> {
  return unwrapStatus(await requireBridge().changePassword(payload));
}

/** `auth:reset-request` — the response never reveals whether the email exists. */
export async function bridgeRequestPasswordReset(payload: { email: string }): Promise<{ ok: true }> {
  return unwrapOk(await requireBridge().requestPasswordReset(payload));
}

/** `auth:list-sessions`. */
export async function bridgeListSessions(): Promise<SessionListResult> {
  return unwrapSessions(await requireBridge().listSessions());
}

/** `auth:revoke-session`. Revoking the *current* session succeeds (200) and logs out. */
export async function bridgeRevokeSession(id: string): Promise<{ ok: true }> {
  return unwrapOk(await requireBridge().revokeSession(id));
}

/** `auth:open-external` — the main process enforces its https host allowlist. */
export async function bridgeOpenExternal(url: string): Promise<{ ok: true }> {
  return unwrapOk(await requireBridge().openExternal(url));
}

/** `auth:changed` — subscribe to main-process pushes; returns the unsubscriber. */
/**
 * Account-centre wrappers.
 *
 * Each one refuses politely when the METHOD is missing (an older main process
 * ships the bridge without them). That is the difference between "the account
 * centre degrades to status + browser" and "the dialog throws when it opens".
 */
export async function bridgeMe(): Promise<MeView> {
  const bridge = requireBridge();
  if (typeof bridge.me !== 'function') throw new AuthBridgeUnavailableError();
  return bridge.me();
}

/** `auth:update-profile` - display name / locale / time zone only. */
export async function bridgeUpdateProfile(payload: UpdateProfilePayload): Promise<MeView> {
  const bridge = requireBridge();
  if (typeof bridge.updateProfile !== 'function') throw new AuthBridgeUnavailableError();
  return bridge.updateProfile(payload);
}

/** `auth:activity` - rows already carry `ipMasked`, never a raw address. */
export async function bridgeActivity(): Promise<ActivityResult> {
  const bridge = requireBridge();
  if (typeof bridge.activity !== 'function') throw new AuthBridgeUnavailableError();
  return bridge.activity();
}

/** `auth:resend-verification` - the 202 body with the new expiry. */
export async function bridgeResendVerification(): Promise<{ sentAt: string; expiresAt: string }> {
  const bridge = requireBridge();
  if (typeof bridge.resendVerification !== 'function') throw new AuthBridgeUnavailableError();
  return bridge.resendVerification();
}

export function bridgeOnChanged(cb: (status: AuthStatus) => void): () => void {
  const bridge = getAuthBridge();
  if (!bridge) return () => {};
  return bridge.onChanged(cb);
}

// ---------------------------------------------------------------------------
// Presentation helpers. Kept next to the contract because every one of them is
// a rule of the contract itself (error codes, version gate, grace window) and
// duplicating them per component is how the two sides drift apart.
// ---------------------------------------------------------------------------

/** i18n keys under `Translations.auth.error` that a server/main-process code maps to. */
export type AuthErrorCopyKey =
  | 'invalidCredentials'
  | 'locked'
  | 'rateLimited'
  | 'suspended'
  | 'revoked'
  | 'expired'
  | 'network'
  | 'graceExpired'
  | 'bridgeUnavailable'
  | 'serverNotConfigured'
  | 'outdatedClient'
  | 'maintenance'
  | 'clockRollback'
  | 'weakPassword'
  | 'emailTaken'
  | 'usernameTaken'
  | 'inviteRequired'
  | 'inviteInvalid'
  | 'registrationDisabled'
  // Account lifecycle (migration 0005).
  | 'emailUnverified'
  | 'accountDeleted'
  | 'deletionPending'
  | 'mailDisabled'
  | 'unknown';

const ERROR_COPY_KEYS: Record<string, AuthErrorCopyKey> = {
  invalid_credentials: 'invalidCredentials',
  password_mismatch: 'invalidCredentials',
  account_locked: 'locked',
  local_admin_locked: 'locked',
  rate_limited: 'rateLimited',
  account_suspended: 'suspended',
  session_revoked: 'revoked',
  session_expired: 'expired',
  unauthorized: 'expired',
  network_unreachable: 'network',
  request_timeout: 'network',
  grace_expired: 'graceExpired',
  bridge_unavailable: 'bridgeUnavailable',
  server_not_configured: 'serverNotConfigured',
  client_outdated: 'outdatedClient',
  maintenance: 'maintenance',
  clock_rollback: 'clockRollback',
  weak_password: 'weakPassword',
  // Registration failures. Without these a taken e-mail address rendered as the
  // generic "something went wrong" — the one message a sign-up flow must never
  // give, because the user's next step is different for each of them.
  email_taken: 'emailTaken',
  username_taken: 'usernameTaken',
  invite_required: 'inviteRequired',
  invite_invalid: 'inviteInvalid',
  invite_exhausted: 'inviteInvalid',
  registration_disabled: 'registrationDisabled',
  // The account-lifecycle codes. Each one has a different next step for the user,
  // so collapsing them into "unknown" would be the same mistake as collapsing the
  // registration failures was.
  email_not_verified: 'emailUnverified',
  email_already_verified: 'emailUnverified',
  deletion_pending: 'deletionPending',
  mail_disabled: 'mailDisabled',
  token_invalid: 'unknown',
};

/** Map a failure code to the `auth.error.*` copy key. Unknown codes are generic. */
export function authErrorCopyKey(code: string, details?: unknown): AuthErrorCopyKey {
  if (code === 'service_unavailable') {
    // One code, two meanings (§4.4): the account server answers
    // `503 + details.reason='maintenance'` while an operator is working on it,
    // and a bare 503 comes from a proxy/outage. Telling the user "维护中" during
    // an outage (or "try again later" during announced maintenance) both lie.
    const reason = details && typeof details === 'object'
      ? (details as { reason?: unknown }).reason
      : undefined;
    return reason === 'maintenance' ? 'maintenance' : 'network';
  }
  return ERROR_COPY_KEYS[code] ?? 'unknown';
}

const REASON_COPY_KEYS: Partial<Record<AuthReason, AuthErrorCopyKey>> = {
  'session-expired': 'expired',
  'session-revoked': 'revoked',
  'account-suspended': 'suspended',
  'account-locked': 'locked',
  'grace-expired': 'graceExpired',
  'clock-rollback': 'clockRollback',
  network: 'network',
  'client-outdated': 'outdatedClient',
  maintenance: 'maintenance',
  'bridge-unavailable': 'bridgeUnavailable',
  'server-not-configured': 'serverNotConfigured',
  'email-unverified': 'emailUnverified',
  // Deliberately ABSENT: `account-deleted`.
  //
  // There is no "this account was deleted" banner on the sign-in form. A deleted
  // account still answers `invalid_credentials`, and a dedicated message would be
  // a "this address existed" oracle for anyone who types one (spec P1-5). The fact
  // is shown by `AccountDeletedScreen`, which is only reachable from a session the
  // main process had already authenticated.
  'deletion-pending': 'deletionPending',
  'mail-disabled': 'mailDisabled',
};

/** Banner copy key for a login-screen `reason`. `undefined` = no banner. */
export function authReasonCopyKey(reason: AuthReason | null): AuthErrorCopyKey | undefined {
  return reason ? REASON_COPY_KEYS[reason] : undefined;
}

/**
 * Read `details.retryAfterSeconds` (lock / rate-limit countdowns).
 *
 * Returns `null` when absent or nonsensical; callers must not invent a number.
 */
export function readRetryAfterSeconds(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null;
  const raw = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.ceil(raw);
}

function numericParts(version: string): number[] {
  return version
    .trim()
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part.replace(/[^0-9].*$/, ''), 10);
      return Number.isFinite(value) ? value : 0;
    });
}

/**
 * Same ordering as the main-process `compareVersions` in `authPolicy.js`:
 * dot-separated numerics, missing segments count as `0`, non-numeric → `0`.
 *
 * @returns `-1`, `0` or `1` when `left` is older, equal or newer than `right`.
 */
export function compareSemver(left: string, right: string): number {
  const a = numericParts(left);
  const b = numericParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days left in the offline grace window (never negative).
 * `null` when there is no deadline — the caller then shows no badge.
 */
export function offlineDaysLeft(graceUntil: string | null, now: number = Date.now()): number | null {
  if (!graceUntil) return null;
  const deadline = Date.parse(graceUntil);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - now) / DAY_MS));
}

/** Seconds left until `deadline` (ISO string); `0` when it has already passed. */
export function secondsUntil(deadline: string | null, now: number = Date.now()): number {
  if (!deadline) return 0;
  const at = Date.parse(deadline);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * Account-service origin used for the "open the web app" links.
 *
 * Order of preference (spec §3.7 / P1-8):
 *  1. the RUNTIME address the main process actually connected to
 *     (`status.server.baseUrl`) — authoritative for a self-hosted instance;
 *  2. the build-time `NEXT_PUBLIC_ACCOUNT_SERVER_URL`, for an older main process
 *     that does not expose a runtime URL;
 *  3. nothing — the helper answers `null` and the caller disables the button
 *     instead of silently navigating to the vendor's site.
 *
 * Rule 3 is the important one: a build-time default of `https://ecliptrix.app`
 * used to send a self-hosted user to a domain that is not theirs, which is a
 * phishing-shaped bug, not a cosmetic one.
 */
const BUILD_TIME_ACCOUNT_ORIGIN = (
  process.env.NEXT_PUBLIC_ACCOUNT_SERVER_URL ?? ''
).trim().replace(/\/+$/, '');

/** Trim a URL down to `scheme://host[:port]`, or '' when it is unusable. */
function originOf(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

/**
 * The account-service origin for this session, or `null` when unknown.
 *
 * @param runtimeBaseUrl `AuthStatus['server']?.baseUrl` (may be absent).
 */
export function accountServiceOrigin(runtimeBaseUrl?: string | null): string | null {
  const runtime = originOf(runtimeBaseUrl);
  if (runtime) return runtime;
  return originOf(BUILD_TIME_ACCOUNT_ORIGIN) || null;
}

/**
 * `/account` on the account service — the "account centre" menu item.
 *
 * @returns the URL, or `null` when the address is unknown (disable the affordance).
 */
export function accountCenterUrl(runtimeBaseUrl?: string | null): string | null {
  const origin = accountServiceOrigin(runtimeBaseUrl);
  return origin ? `${origin}/account` : null;
}

/**
 * `/download` on the account service — the "client too old" escape hatch.
 *
 * Same origin rule as `accountCenterUrl` (see "Order of preference
 * (spec §3.7 / P1-8)" above): the runtime address wins, and Rule 3 applies here
 * too — a hardcoded `https://ecliptrix.app/download` fallback would send a
 * self-hosted user to a domain that is not theirs, which is a phishing-shaped
 * bug, not a convenience. The deleted hardcoded `https://ecliptrix.app/download`
 * was exactly that, so it is gone rather than narrowed — while the build-time
 * `NEXT_PUBLIC_ACCOUNT_SERVER_URL` fallback survives, because an operator set that
 * one deliberately for their own deployment.
 *
 * @param runtimeBaseUrl `AuthStatus['server']?.baseUrl` (may be absent).
 * @returns the URL, or `null` when the origin is unknown — the caller then
 *   disables the button and says why instead of navigating anywhere.
 */
export function clientDownloadUrl(runtimeBaseUrl?: string | null): string | null {
  const origin = accountServiceOrigin(runtimeBaseUrl);
  return origin ? `${origin}/download` : null;
}

/** Which `auth.outdated` hint belongs to a failed "open the download page". */
export type DownloadFailureCopyKey = 'openBlocked' | 'openFailed';

/**
 * Classify a rejected `openExternal(...)`.
 *
 * The bridge REJECTS with the plain `{ ok:false, code }` envelope, so
 * `error instanceof Error` misses every real refusal — `isAuthFailure` is the
 * only correct test. `url_not_allowed` is the main-process allowlist refusing
 * the host (a distinct remedy from "the browser would not open"), everything
 * else is the generic sentence.
 *
 * `auth_busy` is reported separately because it is not a failure at all: another
 * auth action was still running, so nothing was even attempted. Showing "could not
 * open the update page" there would teach the user that the button is broken.
 *
 * @param error whatever the `openExternal` promise rejected with.
 * @returns the `auth.outdated` copy key to show next to the URL, or `null` when
 *   the click was skipped rather than failed.
 */
export function downloadFailureCopyKey(error: unknown): DownloadFailureCopyKey | null {
  if (error instanceof AuthBusyError) return null;
  return isAuthFailure(error) && error.code === 'url_not_allowed'
    ? 'openBlocked'
    : 'openFailed';
}
