'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthContextType, User, LoginCredentials, AuthState } from '@/types/auth';
import { useNotification } from '@/contexts/NotificationContext';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const notification = useNotification();
  
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    sessionToken: null,
  });

  // Validate session periodically
  const validateSession = React.useCallback(async (): Promise<boolean> => {
    const storedUser = localStorage.getItem('ecliptrix-user');
    const storedToken = localStorage.getItem('ecliptrix-session-token');

    if (!storedUser || !storedToken) {
      return false;
    }

    try {
      const user: User = JSON.parse(storedUser);
      console.log('[AuthContext] Validating session for user:', user.username);

      const response = await fetch('/api/auth/validate-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: user.id,
          session_token: storedToken,
        }),
      });

      const data = await response.json();

      if (data.success && data.valid) {
        console.log('[AuthContext] Session is valid');
        return true;
      } else {
        console.warn('[AuthContext] Session is invalid:', data.reason);
        
        // Clear invalid session
        localStorage.removeItem('ecliptrix-user');
        localStorage.removeItem('ecliptrix-session-token');
        
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
        const storedUser = localStorage.getItem('ecliptrix-user');
        const storedToken = localStorage.getItem('ecliptrix-session-token');
        
        if (storedUser && storedToken) {
          const user: User = JSON.parse(storedUser);
          console.log('[AuthContext] Restored user session:', user.username);
          
          // Validate the session
          const isValid = await validateSession();
          
          if (isValid) {
            setAuthState({
              user,
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
        localStorage.removeItem('ecliptrix-user');
        localStorage.removeItem('ecliptrix-session-token');
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

  const login = async (credentials: LoginCredentials): Promise<{ success: boolean; error?: string }> => {
    try {
      console.log('[AuthContext] Login attempt for user:', credentials.username);
      
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      const data = await response.json();

      if (data.success && data.user) {
        console.log('[AuthContext] Login successful:', data.user.username, {
          hasSessionToken: !!data.session_token,
          userRole: data.user.userRole
        });
        
        // Store user and session token in localStorage
        localStorage.setItem('ecliptrix-user', JSON.stringify(data.user));
        if (data.session_token) {
          localStorage.setItem('ecliptrix-session-token', data.session_token);
        }
        
        // Update auth state
        setAuthState({
          user: data.user,
          isAuthenticated: true,
          isLoading: false,
          sessionToken: data.session_token || null,
        });

        // Show success notification with role information
        const roleLabel = data.user.userRole === 'admin' ? '管理员' : 
                         data.user.userRole === 'premium' ? '高级用户' : '普通用户';
        notification.showSuccess(`欢迎回来，${data.user.username}！(${roleLabel})`, 3000);

        return { success: true };
      } else {
        console.warn('[AuthContext] Login failed:', data.error);
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      console.error('[AuthContext] Login error:', error);
      return { success: false, error: 'Network error' };
    }
  };

  const logout = () => {
    console.log('[AuthContext] User logout');
    
    // Clear localStorage
    localStorage.removeItem('ecliptrix-user');
    localStorage.removeItem('ecliptrix-session-token');
    
    // Update auth state
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
    localStorage.setItem('ecliptrix-user', JSON.stringify(updatedUser));
    
    // Update auth state
    setAuthState(prev => ({
      ...prev,
      user: updatedUser,
    }));
  };

  const value: AuthContextType = {
    ...authState,
    login,
    logout,
    updateUserProfile,
    validateSession,
  };

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