'use client';

/**
 * Desktop identity gate state (spec §2.7).
 *
 * The main process owns every piece of truth: this provider only mirrors
 * `auth:status` / `auth:changed` and forwards user actions over the preload
 * bridge. Nothing here is optimistically mutated — the only `setStatus` inputs
 * are snapshots the main process produced (an `auth:changed` push, a
 * `status()` read, or the status an action resolved with).
 *
 * Degradation has exactly two sources of truth as well: whether the bridge
 * exists, and what the main process says. `desktop/ npm run dev` therefore
 * takes the *same* path as a packaged build (its window does have a preload)
 * and is released only because the main process reports `gate-disabled`.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  bridgeChangePassword,
  bridgeListSessions,
  bridgeLogin,
  bridgeLoginLocal,
  bridgeActivity,
  bridgeLogout,
  bridgeMe,
  bridgeOnChanged,
  bridgeOpenExternal,
  bridgeResendVerification,
  bridgeUpdateProfile,
  probeAuthCapabilities,
  bridgeRegister,
  bridgeRequestPasswordReset,
  bridgeRevokeSession,
  bridgeStatus,
  getAuthBridge,
  AuthBusyError,
  AuthBridgeUnavailableError,
  type ActivityResult,
  type AuthBridgeCapabilities,
  type AuthReason,
  type AuthStatus,
  type ChangePasswordPayload,
  type LocalLoginPayload,
  type LoginPayload,
  type MeView,
  type RegisterPayload,
  type SessionListResult,
  type UpdateProfilePayload,
} from '@/lib/api/authBridge';

/** Neutral cold-start snapshot. Identical on the server and the first client frame. */
export const BOOTING_STATUS: AuthStatus = {
  state: 'booting',
  source: null,
  reason: null,
  user: null,
  sessionId: null,
  expiresAt: null,
  lastVerifiedAt: null,
  graceUntil: null,
  mustChangePassword: false,
  appVersion: '',
  server: null,
  reachable: false,
  lockedUntil: null,
  attemptsLeft: null,
  securityWarning: null,
};

export interface SessionContextValue {
  /** Latest main-process snapshot. */
  status: AuthStatus;
  /** `false` when `window.ecliptrixDesktop.auth` is missing. */
  bridgeAvailable: boolean;
  /** An auth action is in flight; buttons must not fire twice. */
  pending: boolean;
  /** `?reason=` from the URL — copy only, it never decides the state. */
  urlReason: AuthReason | null;
  /** Re-read `auth:status` (blocker "retry"). */
  retry: () => void;
  login: (payload: LoginPayload) => Promise<AuthStatus>;
  loginLocal: (payload: LocalLoginPayload) => Promise<AuthStatus>;
  register: (payload: RegisterPayload) => Promise<AuthStatus>;
  logout: () => Promise<AuthStatus>;
  changePassword: (payload: ChangePasswordPayload) => Promise<AuthStatus>;
  requestPasswordReset: (payload: { email: string }) => Promise<{ ok: true }>;
  listSessions: () => Promise<SessionListResult>;
  revokeSession: (id: string) => Promise<{ ok: true }>;
  openExternal: (url: string) => Promise<{ ok: true }>;
  /**
   * Which account-centre capabilities this main process provides.
   *
   * Probed PER METHOD: an older main process ships the bridge without these four,
   * and calling a missing one throws at click time. The dialog renders only what
   * is available (spec §3.10 / P1-7).
   */
  capabilities: AuthBridgeCapabilities;
  me: () => Promise<MeView>;
  updateProfile: (payload: UpdateProfilePayload) => Promise<MeView>;
  activity: () => Promise<ActivityResult>;
  resendVerification: () => Promise<{ sentAt: string; expiresAt: string }>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * State for a renderer that has no auth bridge.
 *
 * Development: a plain browser at `:3000` is a debugging path, so it is let
 * through with a visible amber banner. Everything else — notably a packaged
 * build whose preload went missing — is fail-closed, because "no gate" must
 * never look like "already signed in".
 */
function statusWithoutBridge(): AuthStatus {
  const hasDesktopShell = typeof window !== 'undefined' && !!window.ecliptrixDesktop;
  const isDevBuild = process.env.NODE_ENV !== 'production';
  if (isDevBuild && !hasDesktopShell) {
    return {
      ...BOOTING_STATUS,
      state: 'authenticated',
      source: 'gate-disabled',
      reason: 'gate-disabled',
      reachable: true,
    };
  }
  return { ...BOOTING_STATUS, state: 'blocked', reason: 'bridge-unavailable' };
}

/**
 * Reasons that may arrive in `?reason=`.
 *
 * A WHITELIST, not "any value in `AUTH_REASONS`". The gate state has to be
 * believable: `?reason=account-deleted` used to render the deleted-account copy on
 * the sign-in form with no session at all, which turns a URL into an oracle rather
 * than a hint. Only the two states that describe the *installation* survive —
 * neither of them says anything about an address.
 */
const URL_REASONS: readonly AuthReason[] = [
  'maintenance',
  'client-outdated',
  'server-not-configured',
  'bridge-unavailable',
];

function readUrlReason(): AuthReason | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('reason');
  if (!value) return null;
  return (URL_REASONS as readonly string[]).includes(value) ? (value as AuthReason) : null;
}

interface SessionProviderProps {
  children: React.ReactNode;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>(BOOTING_STATUS);
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [urlReason, setUrlReason] = useState<AuthReason | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const pendingRef = useRef(false);

  useEffect(() => {
    setUrlReason(readUrlReason());
  }, []);

  // Cold start mirror: one `status()` read plus the `auth:changed` subscription.
  // `reloadToken` re-runs it for the blocker's retry button.
  useEffect(() => {
    const bridge = getAuthBridge();
    if (!bridge) {
      setBridgeAvailable(false);
      setStatus(statusWithoutBridge());
      return;
    }
    setBridgeAvailable(true);
    let active = true;
    const unsubscribe = bridgeOnChanged((next) => {
      if (active) setStatus(next);
    });
    bridgeStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        // A dead channel is a bridge problem, not a credentials problem:
        // fail-closed rather than leaving the app on the boot skeleton forever.
        if (active) {
          setStatus({ ...BOOTING_STATUS, state: 'blocked', reason: 'bridge-unavailable' });
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [reloadToken]);

  const retry = useCallback(() => {
    setStatus(BOOTING_STATUS);
    setReloadToken((token) => token + 1);
  }, []);

  /**
   * Run one action with the re-entrancy guard.
   *
   * `pendingRef` (not the state flag) is the guard: two clicks in the same tick
   * see the same stale state value, which is exactly how one login becomes two
   * sessions.
   */
  const runAction = useCallback(async <T,>(run: () => Promise<T>): Promise<T> => {
    if (!getAuthBridge()) throw new AuthBridgeUnavailableError();
    if (pendingRef.current) throw new AuthBusyError();
    pendingRef.current = true;
    setPending(true);
    try {
      return await run();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, []);

  const runForStatus = useCallback(
    (run: () => Promise<AuthStatus>): Promise<AuthStatus> =>
      runAction(async () => {
        const next = await run();
        setStatus(next);
        return next;
      }),
    [runAction],
  );

  const login = useCallback(
    (payload: LoginPayload) => runForStatus(() => bridgeLogin(payload)),
    [runForStatus],
  );
  const loginLocal = useCallback(
    (payload: LocalLoginPayload) => runForStatus(() => bridgeLoginLocal(payload)),
    [runForStatus],
  );
  const register = useCallback(
    (payload: RegisterPayload) => runForStatus(() => bridgeRegister(payload)),
    [runForStatus],
  );
  const logout = useCallback(() => runForStatus(() => bridgeLogout()), [runForStatus]);
  const changePassword = useCallback(
    (payload: ChangePasswordPayload) => runForStatus(() => bridgeChangePassword(payload)),
    [runForStatus],
  );
  const requestPasswordReset = useCallback(
    (payload: { email: string }) => runAction(() => bridgeRequestPasswordReset(payload)),
    [runAction],
  );
  const listSessions = useCallback(
    () => runAction(() => bridgeListSessions()),
    [runAction],
  );
  const revokeSession = useCallback(
    (id: string) => runAction(() => bridgeRevokeSession(id)),
    [runAction],
  );
  const openExternal = useCallback(
    (url: string) => runAction(() => bridgeOpenExternal(url)),
    [runAction],
  );

  // Account centre. Each wrapper re-checks the method: a missing one is reported
  // as "bridge unavailable", never as a crash inside the dialog.
  const me = useCallback(() => runAction(() => bridgeMe()), [runAction]);
  const updateProfile = useCallback(
    (payload: UpdateProfilePayload) => runAction(() => bridgeUpdateProfile(payload)),
    [runAction],
  );
  const activity = useCallback(() => runAction(() => bridgeActivity()), [runAction]);
  const resendVerification = useCallback(
    () => runAction(() => bridgeResendVerification()),
    [runAction],
  );

  const capabilities = useMemo<AuthBridgeCapabilities>(
    () => probeAuthCapabilities(getAuthBridge()),
    // The bridge object is stable per window; re-probe when the status reloads so
    // a dev reload that swapped preload is picked up. Neither dependency is read
    // inside the callback — they are a cache key — so the rule is silenced with
    // that reason rather than by deleting the dependencies (which would keep a
    // stale capability set after a preload swap).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reloadToken, bridgeAvailable],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      bridgeAvailable,
      pending,
      urlReason,
      retry,
      login,
      loginLocal,
      register,
      logout,
      changePassword,
      requestPasswordReset,
      listSessions,
      revokeSession,
      openExternal,
      capabilities,
      me,
      updateProfile,
      activity,
      resendVerification,
    }),
    [
      status,
      bridgeAvailable,
      pending,
      urlReason,
      retry,
      login,
      loginLocal,
      register,
      logout,
      changePassword,
      requestPasswordReset,
      listSessions,
      revokeSession,
      openExternal,
      capabilities,
      me,
      updateProfile,
      activity,
      resendVerification,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = (): SessionContextValue => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
