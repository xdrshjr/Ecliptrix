'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import {
  authErrorCopyKey,
  readRetryAfterSeconds,
  toAuthFailure,
  type AuthFailure,
  type ServerMeta,
} from '@/lib/api/authBridge';

interface ResetPasswordFormProps {
  meta: ServerMeta;
  onBack: () => void;
}

const INPUT =
  'w-full h-11 rounded-lg border border-border bg-input px-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground transition-shadow duration-150 ease-out ' +
  'focus:outline-none focus:ring-2 focus:ring-accent-a/40 motion-reduce:transition-none disabled:opacity-60';
const LABEL = 'block text-xs font-medium text-muted-foreground mb-1.5';
const SUBMIT =
  'w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium ' +
  'transition-opacity duration-150 ease-out hover:opacity-90 disabled:opacity-60 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

/**
 * Self-service password reset (spec §2.8).
 *
 * `smtpEnabled === false` has no self-service path at all, so the panel turns
 * into an instruction to ask an administrator for a one-time password — never
 * a dead form that silently does nothing.
 *
 * On success the copy is always "if that email exists, a reset link has been
 * sent": the endpoint must not be usable as an account-existence oracle.
 */
export default function ResetPasswordForm({ meta, onBack }: ResetPasswordFormProps) {
  const { t } = useLocale();
  const { requestPasswordReset, pending } = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || !email.trim()) return;
    setFailure(null);
    try {
      await requestPasswordReset({ email: email.trim() });
      setSent(true);
    } catch (error) {
      const failure = toAuthFailure(error);
      // The double-submit guard raising `auth_busy` is the protector working, not a
      // user-facing failure: showing "something went wrong" for one Enter keypress
      // held down twice is how a working form looks broken.
      if (failure.code === 'auth_busy') return;
      setFailure(failure);
    }
  };

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
    >
      {t.auth.backToLogin}
    </button>
  );

  if (!meta.smtpEnabled) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t.auth.reset.contactAdmin}</p>
        {meta.supportEmail && (
          <a
            href={`mailto:${meta.supportEmail}`}
            className="block text-sm text-primary hover:underline break-all"
          >
            {meta.supportEmail}
          </a>
        )}
        {back}
      </div>
    );
  }

  if (sent) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <p className="text-sm text-muted-foreground">{t.auth.reset.sent}</p>
        {back}
      </div>
    );
  }

  const errorText = failure ? t.auth.error[authErrorCopyKey(failure.code, failure.details)] : null;
  const retryAfter = failure ? readRetryAfterSeconds(failure.details) : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label className={LABEL} htmlFor="reset-email">
          {t.auth.identifier.label}
        </label>
        <input
          id="reset-email"
          type="email"
          autoFocus
          autoComplete="email"
          className={INPUT}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div aria-live="polite">
        {errorText && (
          <div
            role="alert"
            className="rounded-lg border border-destructive-a/40 bg-destructive-a/10 px-3 py-2 text-xs text-destructive"
          >
            {errorText}
            {retryAfter && (
              <span className="ml-2 opacity-90">
                {t.auth.error.retryIn.replace('{seconds}', String(retryAfter))}
              </span>
            )}
          </div>
        )}
      </div>

      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? t.auth.submitting : t.auth.submit}
      </button>
      {back}
    </form>
  );
}
