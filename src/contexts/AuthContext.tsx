'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { AuthContextType, User, LoginCredentials, AuthState } from '@/types/auth';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import {
  SESSION_TOKEN_KEY,
  SESSION_USER_KEY,
  setSessionToken,
  clearSessionToken,
} from '@/lib/auth/storage-keys';
import {
  login as authLogin,
  validateSession as authValidateSession,
} from '@/lib/api/auth';
import {
  ApiError,
  TimeoutError,
  resetSessionExpiryFlag,
} from '@/lib/api/http-client';

let lastNetworkWarnAt = 0;
const NETWORK_WARN_THROTTLE_MS = 30_000;

// 429 toast throttle. A TIME-WINDOW throttle (NOT a permanent latch like the
// 401 `sessionExpiryHandled` flag) so repeated bursts of 429s show at most one
// toast per window, yet a 429 minutes later still surfaces. The window adapts
// to the server's Retry-After (so we don't re-toast within the cooldown the
// server already asked for), clamped to a small minimum.
let lastRateLimitWarnAt = 0;
const RATE_LIMIT_WARN_MIN_WINDOW_MS = 3_000;

function isNetworkUnreachable(err: unknown): boolean {
  return (
    (err instanceof ApiError && err.code === 'NETWORK_ERROR') ||
    err instanceof TimeoutError
  );
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Map snake_case backend user fields to camelCase frontend User fields.
 *
 * When `partial` is true the result only contains keys that were actually
 * present in `raw`, so spreading it onto an existing User won't clobber
 * populated fields with empty strings / undefined.  `partial` defaults to
 * false for the login path where the backend always returns a full object.
 */
function normalizeUser(raw: Record<string, unknown>, partial = false): User {
  const id = (raw.id as string | undefined);
  const username = (raw.username as string | undefined);
  const email = (raw.email as string | undefined);
  const avatar = (raw.avatar as string | undefined);
  const fullName = (raw.fullName ?? raw.full_name) as string | undefined;
  const avatarUrl = (raw.avatarUrl ?? raw.avatar_url) as string | undefined;
  const userRole = (raw.userRole ?? raw.user_role) as User['userRole'];
  const isAdmin = (raw.isAdmin ?? raw.is_admin) as boolean | undefined;
  const isRoot = (raw.isRoot ?? raw.is_root) as boolean | undefined;

  if (partial) {
    // Only include keys that the backend actually sent so that a spread
    // merge will not overwrite existing values with undefined / ''.
    const result: Partial<User> = {};
    if (id !== undefined) result.id = id;
    if (username !== undefined) result.username = username;
    if (email !== undefined) result.email = email;
    if (avatar !== undefined) result.avatar = avatar;
    if (fullName !== undefined) result.fullName = fullName;
    if (avatarUrl !== undefined) result.avatarUrl = avatarUrl;
    if (userRole !== undefined) result.userRole = userRole;
    if (isAdmin !== undefined) result.isAdmin = isAdmin;
    if (isRoot !== undefined) result.isRoot = isRoot;
    return result as User;
  }

  return {
    id: id ?? '',
    username: username ?? '',
    email,
    avatar,
    fullName,
    avatarUrl,
    userRole,
    isAdmin,
    isRoot,
  };
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const notification = useNotification();
  const { t } = useLocale();

  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    sessionToken: null,
  });

  // Validate session periodically
  const validateSession = React.useCallback(async (): Promise<boolean> => {
    const storedUser = localStorage.getItem(SESSION_USER_KEY);
    const storedToken = localStorage.getItem(SESSION_TOKEN_KEY);

    if (!storedUser || !storedToken) {
      return false;
    }

    try {
      const user: User = JSON.parse(storedUser);

      const data = (await authValidateSession({
        user_id: user.id,
        session_token: storedToken,
      })) as unknown as {
        success?: boolean;
        valid?: boolean;
        reason?: string;
        message?: string;
        user?: Record<string, unknown>;
      };

      if (data.success && data.valid) {
        // If the validation response carries updated user fields (e.g. is_root),
        // merge them into the stored user so permissions stay in sync.
        if (data.user) {
          const refreshed = normalizeUser(data.user, true);
          const merged: User = { ...user, ...refreshed };
          localStorage.setItem(SESSION_USER_KEY, JSON.stringify(merged));
          setAuthState(prev => ({
            ...prev,
            user: merged,
          }));
        }

        // Self-heal the session cookie: users who logged in before the cookie
        // sync shipped have a token only in localStorage, so media-tag requests
        // (`/api/storage/files/...`) would still 401. Re-sync on every confirmed
        // -live session (mount + 5-min poll) so the cookie always exists.
        setSessionToken(storedToken);

        return true;
      } else {
        console.warn('[AuthContext] Session is invalid:', data.reason);

        // Clear invalid session
        localStorage.removeItem(SESSION_USER_KEY);
        clearSessionToken();

        setAuthState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          sessionToken: null,
        });

        // Show toast notification to user
        if (data.reason) {
          const sessionReasonMap: Record<string, string> = {
            '用户不存在': t.adminSettings.sessionInvalid,
            '用户已被禁用': t.adminSettings.sessionInvalid,
            '无活跃会话': t.adminSettings.sessionInvalid,
            '您的账号已在另一台设备上登录': t.adminSettings.sessionInvalid,
          };
          const msg = sessionReasonMap[data.reason] || t.adminSettings.sessionInvalid;
          notification.showWarning(msg, 6000);
        }

        return false;
      }
    } catch (error) {
      if (isNetworkUnreachable(error)) {
        const now = Date.now();
        if (now - lastNetworkWarnAt > NETWORK_WARN_THROTTLE_MS) {
          lastNetworkWarnAt = now;
          const code = error instanceof ApiError ? error.code : 'TIMEOUT';
          console.warn('[AuthContext] Session validation skipped:', code);
        }
        return false;
      }
      console.error('[AuthContext] Session validation error:', error);
      return false;
    }
  }, [notification]);

  // Load auth state from localStorage on mount
  useEffect(() => {
    const loadAuthState = async () => {
      try {
        const storedUser = localStorage.getItem(SESSION_USER_KEY);
        const storedToken = localStorage.getItem(SESSION_TOKEN_KEY);

        if (storedUser && storedToken) {
          const user: User = JSON.parse(storedUser);

          // Validate the session
          const isValid = await validateSession();

          if (isValid) {
            // Re-read from localStorage because validateSession may have updated it
            const refreshedRaw = localStorage.getItem(SESSION_USER_KEY);
            const refreshedUser: User = refreshedRaw ? JSON.parse(refreshedRaw) : user;

            setAuthState({
              user: refreshedUser,
              isAuthenticated: true,
              isLoading: false,
              sessionToken: storedToken,
            });
          } else {
            // Stored session is invalid — settle to unauthenticated on every
            // platform. The desktop login gate (AuthGate → LoginScreen) surfaces
            // in place; there is no silent auto-login any more (spec §2.2/§2.3).
            setAuthState({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              sessionToken: null,
            });
          }
        } else {
          // No stored session — land unauthenticated. On desktop this is what
          // raises the mandatory login gate; on web it shows the landing page.
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
      } catch (error) {
        console.error('[AuthContext] Error loading auth state:', error);
        localStorage.removeItem(SESSION_USER_KEY);
        clearSessionToken();
        setAuthState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          sessionToken: null,
        });
      }
    };

    loadAuthState();
    // This effect runs the mount-time session bootstrap once. validateSession is
    // a stable callback; other setters are intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateSession]);

  // Periodically validate session (every 5 minutes)
  useEffect(() => {
    if (!authState.isAuthenticated) return;

    const interval = setInterval(() => {
      validateSession();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [authState.isAuthenticated, validateSession]);

  // Listen for the global `ecliptrix:session-expired` event dispatched by
  // `src/lib/api/http-client.ts` when any browser->backend call returns 401.
  // The wrapper has already cleared localStorage and (on web) navigated to
  // /login, so all we need to do here is mirror the in-memory React state. We
  // do NOT call the backend logout endpoint — the 401 already proved the
  // session is invalid server-side. On desktop, clearing isAuthenticated lets
  // AuthGate surface the LoginScreen in place (spec §2.4).
  useEffect(() => {
    const handleSessionExpired = () => {
      // Defensive: ensure localStorage is cleared even if the event fires
      // outside the wrapper's normal path.
      try {
        localStorage.removeItem(SESSION_USER_KEY);
        clearSessionToken();
      } catch {
        // ignore
      }
      setAuthState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        sessionToken: null,
      });
    };

    window.addEventListener('ecliptrix:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('ecliptrix:session-expired', handleSessionExpired);
    };
  }, []);

  // Listen for the global `ecliptrix:rate-limited` event dispatched by
  // `src/lib/api/http-client.ts` when any browser->backend call returns 429.
  // Show ONE friendly warning toast with the Retry-After countdown. We throttle
  // by TIME WINDOW (not a permanent latch): a burst of 429s shows a single
  // toast, but a later 429 still surfaces. The window adapts to Retry-After so
  // we don't re-toast inside the cooldown the server already requested.
  useEffect(() => {
    const handleRateLimited = (event: Event) => {
      const detail = (event as CustomEvent<{ retryAfter?: number; message?: string }>).detail;
      const retryAfter =
        typeof detail?.retryAfter === 'number' && detail.retryAfter > 0
          ? detail.retryAfter
          : 5;

      const now = Date.now();
      const windowMs = Math.max(retryAfter * 1000, RATE_LIMIT_WARN_MIN_WINDOW_MS);
      if (now - lastRateLimitWarnAt < windowMs) {
        return; // within the cooldown — suppress duplicate toast
      }
      lastRateLimitWarnAt = now;

      const msg = t.adminSettings.rateLimited.replace('{seconds}', String(retryAfter));
      // Show for at least the retry window so the countdown copy stays visible.
      notification.showWarning(msg, Math.max(retryAfter * 1000, 4000));
    };

    window.addEventListener('ecliptrix:rate-limited', handleRateLimited);
    return () => {
      window.removeEventListener('ecliptrix:rate-limited', handleRateLimited);
    };
  }, [notification, t]);

  const login = async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> => {
    try {
      // The auth client (`src/lib/api/auth.ts`) owns the
      // `result.user → frontend User` reshape that previously lived in
      // `src/app/api/auth/login/route.ts` (delegated by T04 / T05).
      const result = await authLogin(credentials);

      if (result.success) {
        const user = result.user;

        // Reset session expiry flag so future expirations trigger redirect
        resetSessionExpiryFlag();

        // Store user and session token in localStorage
        localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
        if (result.sessionToken) {
          setSessionToken(result.sessionToken);
        }

        // Update auth state
        setAuthState({
          user,
          isAuthenticated: true,
          isLoading: false,
          sessionToken: result.sessionToken || null,
        });

        // Show success notification with role information
        const roleLabel = user.isRoot ? t.adminSettings.roleRoot :
                         user.userRole === 'admin' ? t.adminSettings.roleAdmin :
                         user.userRole === 'premium' ? t.adminSettings.rolePremium :
                         t.adminSettings.roleRegular;
        const msg = t.auth.welcomeBackMessage
          .replace('{username}', user.username)
          .replace('{role}', roleLabel);
        notification.showSuccess(msg, 3000);

        return { success: true };
      } else {
        console.warn('[AuthContext] Login failed:', result.error);
        return { success: false, error: result.error || 'Login failed' };
      }
    } catch (error) {
      console.error('[AuthContext] Login error:', error);
      const isTimeout =
        error instanceof Error && error.name === 'TimeoutError';
      const message = isTimeout
        ? (t.auth.networkTimeout ?? 'Request timed out')
        : (t.auth.networkError ?? 'Network error');
      return { success: false, error: message };
    }
  };

  const logout = () => {
    // Clear localStorage
    localStorage.removeItem(SESSION_USER_KEY);
    clearSessionToken();

    // Update auth state — all permission fields are cleared because user is null
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      sessionToken: null,
    });
  };

  const updateUserProfile = async (updatedUser: User) => {
    // Update localStorage
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(updatedUser));

    // Update auth state
    setAuthState(prev => ({
      ...prev,
      user: updatedUser,
    }));
  };

  // Derive permission booleans from user state
  const isRoot = authState.user?.isRoot === true;
  const isAdmin = authState.user?.isAdmin === true || authState.user?.userRole === 'admin' || isRoot;
  const canManageUsers = isAdmin;
  const canManageAdmins = isRoot;

  const value: AuthContextType = useMemo(() => ({
    ...authState,
    isRoot,
    isAdmin,
    canManageUsers,
    canManageAdmins,
    login,
    logout,
    updateUserProfile,
    validateSession,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [authState, isRoot, isAdmin, canManageUsers, canManageAdmins]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
