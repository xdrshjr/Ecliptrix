'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { AuthContextType, User, LoginCredentials, AuthState } from '@/types/auth';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { SESSION_TOKEN_KEY, SESSION_USER_KEY } from '@/lib/auth/storage-keys';
import {
  login as authLogin,
  validateSession as authValidateSession,
} from '@/lib/api/auth';

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
      console.log('[AuthContext] Validating session for user:', user.username);

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
        console.log('[AuthContext] Session is valid');

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

        return true;
      } else {
        console.warn('[AuthContext] Session is invalid:', data.reason);

        // Clear invalid session
        localStorage.removeItem(SESSION_USER_KEY);
        localStorage.removeItem(SESSION_TOKEN_KEY);

        setAuthState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          sessionToken: null,
        });

        // Show toast notification to user
        if (data.reason) {
          notification.showWarning(data.reason, 6000);
        }

        return false;
      }
    } catch (error) {
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
          console.log('[AuthContext] Restored user session:', user.username);

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
            setAuthState({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              sessionToken: null,
            });
          }
        } else {
          setAuthState(prev => ({ ...prev, isLoading: false }));
        }
      } catch (error) {
        console.error('[AuthContext] Error loading auth state:', error);
        localStorage.removeItem(SESSION_USER_KEY);
        localStorage.removeItem(SESSION_TOKEN_KEY);
        setAuthState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          sessionToken: null,
        });
      }
    };

    loadAuthState();
  }, [validateSession]);

  // Periodically validate session (every 5 minutes)
  useEffect(() => {
    if (!authState.isAuthenticated) return;

    const interval = setInterval(() => {
      console.log('[AuthContext] Periodic session validation');
      validateSession();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [authState.isAuthenticated, validateSession]);

  // Listen for the global `ecliptrix:session-expired` event dispatched by
  // `src/lib/api/http-client.ts` when any browser->backend call returns 401.
  // The wrapper has already cleared localStorage and (when appropriate)
  // navigated to /login, so all we need to do here is mirror the in-memory
  // React state. We do NOT call the backend logout endpoint — the 401 already
  // proved the session is invalid server-side.
  useEffect(() => {
    const handleSessionExpired = () => {
      console.log('[AuthContext] Received ecliptrix:session-expired event');
      // Defensive: ensure localStorage is cleared even if the event fires
      // outside the wrapper's normal path.
      try {
        localStorage.removeItem(SESSION_USER_KEY);
        localStorage.removeItem(SESSION_TOKEN_KEY);
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

  const login = async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('[AuthContext] Login attempt for user:', credentials.username);

      // The auth client (`src/lib/api/auth.ts`) owns the
      // `result.user → frontend User` reshape that previously lived in
      // `src/app/api/auth/login/route.ts` (delegated by T04 / T05).
      const result = await authLogin(credentials);

      if (result.success) {
        const user = result.user;

        console.log('[AuthContext] Login successful:', user.username, {
          hasSessionToken: !!result.sessionToken,
          userRole: user.userRole,
          isRoot: user.isRoot,
          isAdmin: user.isAdmin,
        });

        // Store user and session token in localStorage
        localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
        if (result.sessionToken) {
          localStorage.setItem(SESSION_TOKEN_KEY, result.sessionToken);
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
        notification.showSuccess(`${t.auth.welcomeBack}，${user.username}！(${roleLabel})`, 3000);

        return { success: true };
      } else {
        console.warn('[AuthContext] Login failed:', result.error);
        return { success: false, error: result.error || 'Login failed' };
      }
    } catch (error) {
      console.error('[AuthContext] Login error:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const logout = () => {
    console.log('[AuthContext] User logout');

    // Clear localStorage
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem(SESSION_TOKEN_KEY);

    // Update auth state — all permission fields are cleared because user is null
    setAuthState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      sessionToken: null,
    });
  };

  const updateUserProfile = async (updatedUser: User) => {
    console.log('[AuthContext] Updating user profile:', updatedUser.username);

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
