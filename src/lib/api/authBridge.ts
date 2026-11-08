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
  | 'internal-error';

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
  role: { key: string; name: string };
  permissions: string[];
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
 * Account-service origin used for the two "open the web app" links.
 *
 * The renderer deliberately does not receive the account server URL (§4.6:
 * "渲染进程永远不需要知道它"), so a self-hosted deployment can pin it at build
 * time with `NEXT_PUBLIC_ACCOUNT_SERVER_URL`; otherwise the hosted origin is
 * used. Both are inside the main process `openExternal` allowlist, and a
 * rejection is surfaced as an inline hint instead of a blank window.
 */
const ACCOUNT_SERVICE_ORIGIN = (
  process.env.NEXT_PUBLIC_ACCOUNT_SERVER_URL ?? ''
).trim().replace(/\/+$/, '') || 'https://ecliptrix.app';

/** `/account` on the account service — the "account centre" menu item. */
export function accountCenterUrl(): string {
  return `${ACCOUNT_SERVICE_ORIGIN}/account`;
}

/** `/download` on the account service — the "client too old" escape hatch. */
export function clientDownloadUrl(): string {
  return `${ACCOUNT_SERVICE_ORIGIN}/download`;
}
