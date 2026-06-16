'use client';

import { useState, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotification } from '@/contexts/NotificationContext';

/**
 * Shared login-form logic for `LoginScreen` (the desktop login gate) and the
 * web `LoginModal`.
 *
 * The two surfaces differ only in chrome (a closable modal vs. a full-window
 * gate with a brand panel); the username/password state, validation, CapsLock
 * detection, show/hide-password toggle and the submit → `AuthContext.login`
 * error handling are identical, so they live here to avoid drift (spec §6/R6).
 */
export interface UseLoginFormOptions {
  /** Called after a successful login (e.g. close the modal). Optional — the
   *  gate has nothing to close. */
  onSuccess?: () => void;
}

export interface UseLoginFormResult {
  username: string;
  password: string;
  setUsername: (value: string) => void;
  setPassword: (value: string) => void;
  showPassword: boolean;
  toggleShowPassword: () => void;
  capsLockOn: boolean;
  onPasswordKeyEvent: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  isLoading: boolean;
  error: string;
  /** username && password && !isLoading */
  canSubmit: boolean;
  reset: () => void;
  submit: (event?: React.FormEvent) => Promise<void>;
}

export function useLoginForm(options: UseLoginFormOptions = {}): UseLoginFormResult {
  const { onSuccess } = options;
  const { t } = useLocale();
  const { login } = useAuth();
  const notification = useNotification();

  const [username, setUsernameState] = useState('');
  const [password, setPasswordState] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Clear the error as soon as the user edits either field so a stale failure
  // message never lingers over fresh input (spec §6.3).
  const setUsername = useCallback((value: string) => {
    setUsernameState(value);
    setError((prev) => (prev ? '' : prev));
  }, []);

  const setPassword = useCallback((value: string) => {
    setPasswordState(value);
    setError((prev) => (prev ? '' : prev));
  }, []);

  const toggleShowPassword = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  const onPasswordKeyEvent = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      try {
        setCapsLockOn(event.getModifierState('CapsLock'));
      } catch {
        // getModifierState is unavailable on synthetic events in some
        // environments — degrade to "no CapsLock hint" rather than throwing.
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setUsernameState('');
    setPasswordState('');
    setShowPassword(false);
    setCapsLockOn(false);
    setIsLoading(false);
    setError('');
  }, []);

  const canSubmit = !!username && !!password && !isLoading;

  const submit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();

      if (!username || !password) {
        setError(t.auth.requiredFields);
        return;
      }

      setIsLoading(true);
      setError('');

      try {
        const result = await login({ username, password });
        if (result.success) {
          onSuccess?.();
        } else {
          const message = result.error || t.auth.loginFailed;
          setError(message);
          notification.showError(message, 4000);
        }
      } catch {
        setError(t.auth.loginFailed);
        notification.showError(t.auth.loginFailed, 4000);
      } finally {
        setIsLoading(false);
      }
    },
    [username, password, login, notification, onSuccess, t],
  );

  return {
    username,
    password,
    setUsername,
    setPassword,
    showPassword,
    toggleShowPassword,
    capsLockOn,
    onPasswordKeyEvent,
    isLoading,
    error,
    canSubmit,
    reset,
    submit,
  };
}
