'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import {
  authErrorCopyKey,
  readRetryAfterSeconds,
  toAuthFailure,
  type AuthFailure,
} from '@/lib/api/authBridge';

interface ServerLoginFormProps {
  /**
   * Switch the surrounding screen to the password-reset panel. Omitted when the
   * server metadata is unavailable: a reset link needs `/meta` (`smtpEnabled`) to
   * decide what to show, so the affordance is hidden instead of dead.
   */
  onForgot?: () => void;
}

const INPUT =
  'w-full h-11 rounded-lg border border-border bg-input px-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground transition-shadow duration-150 ease-out ' +
  'focus:outline-none focus:ring-2 focus:ring-accent-a/40 focus:ring-offset-0 ' +
  'motion-reduce:transition-none disabled:opacity-60';
const LABEL = 'block text-xs font-medium text-muted-foreground mb-1.5';
const SUBMIT =
  'w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium ' +
  'transition-opacity duration-150 ease-out hover:opacity-90 disabled:opacity-60 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

/**
 * Whole-form error, faded in with opacity only (spec §2.8: no displacement, so
 * the form never jumps). `motion-reduce` drops the transition entirely.
 */
function ErrorAlert({ text, suffix }: { text: string | null; suffix?: string | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    if (!text) return;
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, [text]);

  if (!text) return null;
  return (
    <div
      role="alert"
      style={{ opacity: visible ? 1 : 0 }}
      className="rounded-lg border border-destructive-a/40 bg-destructive-a/10 px-3 py-2 text-xs text-destructive transition-opacity duration-150 ease-out motion-reduce:transition-none motion-reduce:duration-0"
    >
      <span>{text}</span>
      {suffix && <span className="ml-2 opacity-90">{suffix}</span>}
    </div>
  );
}

/** Seconds ticking down to zero; `null` means "no countdown". */
function useCountdown(seconds: number | null): number {
  const [left, setLeft] = useState(seconds ?? 0);

  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds || seconds <= 0) return;
    const timer = setInterval(() => {
      setLeft((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  return left;
}

/**
 * Form A — account-server sign in (spec §2.8).
 *
 * Every affordance required there lives in this file: `autoComplete`, first
 * field `autoFocus`, Enter submits (native form), Esc clears errors, the eye
 * button with `aria-pressed`, the Caps Lock hint, a countdown that disables the
 * button while locked/rate-limited, and the request-id footer used for support.
 */
export default function ServerLoginForm({ onForgot }: ServerLoginFormProps) {
  const { t } = useLocale();
  const { login, pending } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const lockedFor = useCountdown(retryAfter);
  const isLocked = lockedFor > 0;
  const identifierRef = useRef<HTMLInputElement>(null);

  const clearErrors = () => {
    setFailure(null);
    setFieldErrors({});
    setRetryAfter(null);
  };

  const applyFailure = (next: AuthFailure) => {
    setFailure(next);
    setRetryAfter(readRetryAfterSeconds(next.details));
  };

  const validate = () => {
    const next: { identifier?: string; password?: string } = {};
    if (!identifier.trim()) next.identifier = t.auth.error.required;
    if (!password) next.password = t.auth.error.required;
    return next;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || isLocked) return;
    const nextFieldErrors = validate();
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) return;
    setFailure(null);
    setRetryAfter(null);
    try {
      await login({ identifier: identifier.trim(), password, rememberDevice });
    } catch (error) {
      const failure = toAuthFailure(error);
      // The double-submit guard raising `auth_busy` is the protector working, not
      // a user-facing failure: a held-down Enter would flash "something went wrong".
      if (failure.code === 'auth_busy') return;
      applyFailure(failure);
      identifierRef.current?.focus();
    }
  };

  const copyKey = failure ? authErrorCopyKey(failure.code, failure.details) : null;
  const errorText = copyKey ? t.auth.error[copyKey] : null;
  const remaining = isLocked ? fill(t.auth.error.retryIn, { seconds: lockedFor }) : null;

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') clearErrors();
      }}
      className={`space-y-4 ${pending ? 'pointer-events-none' : ''}`}
      noValidate
    >
      <div>
        <label className={LABEL} htmlFor="auth-identifier">
          {t.auth.identifier.label}
        </label>
        <input
          id="auth-identifier"
          ref={identifierRef}
          name="identifier"
          type="text"
          autoFocus
          autoComplete="username"
          inputMode={identifier.includes('@') ? 'email' : 'text'}
          placeholder={t.auth.identifier.placeholder}
          className={INPUT}
          value={identifier}
          disabled={isLocked}
          aria-invalid={!!fieldErrors.identifier}
          aria-describedby={fieldErrors.identifier ? 'auth-identifier-error' : undefined}
          onChange={(event) => setIdentifier(event.target.value)}
        />
        {fieldErrors.identifier && (
          <p id="auth-identifier-error" className="mt-1.5 text-xs text-destructive">
            {fieldErrors.identifier}
          </p>
        )}
      </div>

      <div>
        <label className={LABEL} htmlFor="auth-password">
          {t.auth.password.label}
        </label>
        <div className="relative">
          <input
            id="auth-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            className={`${INPUT} pr-11`}
            value={password}
            disabled={isLocked}
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
            onChange={(event) => setPassword(event.target.value)}
            onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
            onKeyDown={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-pressed={showPassword}
            aria-label={showPassword ? t.auth.password.hide : t.auth.password.show}
            title={showPassword ? t.auth.password.hide : t.auth.password.show}
            className="absolute right-1 top-1 h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"
              />
              <circle cx="12" cy="12" r="2.6" strokeWidth={1.8} />
              {!showPassword && (
                <path strokeLinecap="round" strokeWidth={1.8} d="M4 20L20 4" />
              )}
            </svg>
          </button>
        </div>
        {fieldErrors.password && (
          <p id="auth-password-error" className="mt-1.5 text-xs text-destructive">
            {fieldErrors.password}
          </p>
        )}
        {capsLock && (
          <p className="mt-1.5 text-xs text-amber-500" role="status">
            {t.auth.password.capsLock}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-border bg-input accent-primary"
            checked={rememberDevice}
            disabled={isLocked}
            onChange={(event) => setRememberDevice(event.target.checked)}
          />
          {t.auth.remember}
        </label>
        {onForgot && (
          <button
            type="button"
            onClick={onForgot}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {t.auth.forgot}
          </button>
        )}
      </div>

      <div aria-live="polite" className="min-h-0">
        <ErrorAlert text={errorText} suffix={remaining} />
      </div>

      <button type="submit" disabled={pending || isLocked} className={SUBMIT}>
        {pending ? (
          <span className="inline-flex items-center justify-center gap-2">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
            />
            {t.auth.submitting}
          </span>
        ) : (
          t.auth.submit
        )}
      </button>

      {failure?.requestId && (
        <p className="text-center text-[11px] text-muted-foreground">
          {fill(t.auth.error.requestId, { id: failure.requestId })}
        </p>
      )}
    </form>
  );
}
