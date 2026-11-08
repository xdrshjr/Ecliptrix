'use client';

import React, { useEffect, useId, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import {
  authErrorCopyKey,
  secondsUntil,
  toAuthFailure,
  type AuthFailure,
} from '@/lib/api/authBridge';

const INPUT =
  'w-full h-11 rounded-lg border border-border bg-input px-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground transition-shadow duration-150 ease-out ' +
  'focus:outline-none focus:ring-2 focus:ring-accent-a/40 motion-reduce:transition-none ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';
const LABEL = 'block text-xs font-medium text-muted-foreground mb-1.5';
const SUBMIT =
  'w-full h-11 rounded-lg border border-destructive-a/50 bg-destructive-a/10 text-destructive ' +
  'text-sm font-medium transition-opacity duration-150 ease-out hover:opacity-90 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-destructive-a/60 motion-reduce:transition-none';

const DEFAULT_LOCAL_PASSWORD = 'adminjr';
const MIN_SAFE_LOCAL_PASSWORD = 10;

/** True for the shipped default and for anything shorter than a safe length. */
function isWeakLocalPassword(password: string): boolean {
  if (!password) return false;
  return (
    password.toLowerCase() === DEFAULT_LOCAL_PASSWORD || password.length < MIN_SAFE_LOCAL_PASSWORD
  );
}

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

/**
 * Form B — the break-glass local administrator (spec §2.8 / §2.9).
 *
 * It is a text button that expands an *inline* form: a modal would cover the
 * attempt counter and the lock countdown, which are exactly what a rescuer
 * needs to see. Nothing here talks to the network — `loginLocal` never leaves
 * the main process, and the password is only compared there.
 *
 * The weak-password warning never blocks the form: blocking would defeat the
 * purpose of a rescue path.
 */
export default function LocalAdminForm() {
  const { t } = useLocale();
  const { loginLocal, pending, status } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const hintId = useId();

  const lockedUntil = status.lockedUntil;
  const lockedSeconds = secondsUntil(lockedUntil, now);

  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  const isLocked = lockedSeconds > 0;
  const showWeakWarning =
    status.securityWarning === 'local-default-password' || isWeakLocalPassword(password);
  const attemptsLeft = typeof status.attemptsLeft === 'number' ? status.attemptsLeft : null;
  const errorText = failure ? t.auth.error[authErrorCopyKey(failure.code, failure.details)] : null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || isLocked) return;
    if (!username.trim() || !password) return;
    setFailure(null);
    try {
      await loginLocal({ username: username.trim(), password });
    } catch (error) {
      const failure = toAuthFailure(error);
      // The double-submit guard raising `auth_busy` is the protector working, not a
      // user-facing failure: showing "something went wrong" for one Enter keypress
      // held down twice is how a working form looks broken.
      if (failure.code === 'auth_busy') return;
      setFailure(failure);
      setNow(Date.now());
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-describedby={hintId}
        className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        {t.auth.local.entry}
        <span id={hintId} className="sr-only">
          {t.auth.local.hint}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-destructive-a/40 bg-destructive-a/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{t.auth.local.title}</p>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.common.close}
        </button>
      </div>

      <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-amber-500">
        {t.auth.local.hint}
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3" noValidate>
        <div>
          <label className={LABEL} htmlFor="local-admin-username">
            {t.auth.username.label}
          </label>
          <input
            id="local-admin-username"
            type="text"
            autoComplete="username"
            className={INPUT}
            value={username}
            disabled={isLocked}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor="local-admin-password">
            {t.auth.password.label}
          </label>
          <input
            id="local-admin-password"
            type="password"
            autoComplete="current-password"
            className={INPUT}
            value={password}
            disabled={isLocked}
            aria-describedby={showWeakWarning ? `${hintId}-weak` : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          {showWeakWarning && (
            <p id={`${hintId}-weak`} className="mt-1.5 text-[11px] leading-relaxed text-destructive">
              {t.auth.local.defaultPasswordWarning}
            </p>
          )}
        </div>

        {isLocked && (
          <p className="text-[11px] text-amber-500" role="status" aria-live="polite">
            {fill(t.auth.local.lockIn, { seconds: lockedSeconds })}
          </p>
        )}
        {!isLocked && attemptsLeft !== null && (
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            {fill(t.auth.local.attemptsLeft, { count: attemptsLeft })}
          </p>
        )}

        <div aria-live="polite">
          {errorText && (
            <div role="alert" className="rounded-lg bg-destructive-a/10 px-3 py-2 text-xs text-destructive">
              {errorText}
            </div>
          )}
        </div>

        <button type="submit" disabled={pending || isLocked} className={SUBMIT}>
          {pending ? t.auth.submitting : t.auth.local.submit}
        </button>
      </form>
    </div>
  );
}
