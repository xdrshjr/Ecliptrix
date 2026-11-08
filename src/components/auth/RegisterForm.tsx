'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import {
  authErrorCopyKey,
  toAuthFailure,
  type AuthFailure,
  type ServerMeta,
} from '@/lib/api/authBridge';

interface RegisterFormProps {
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

type Score = 0 | 1 | 2 | 3;

/**
 * Four-band strength score, aligned with the server policy `minLength`
 * (10 by default) and with `webserver/src/components/auth/password-strength.tsx`.
 * Below the minimum there is no band at all — the field error says why.
 */
export function passwordScore(password: string, minLength: number): Score {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((rule) =>
    rule.test(password),
  ).length;
  if (password.length < minLength) return 0;
  if (password.length >= minLength + 6 && classes >= 3) return 3;
  if (classes >= 3 || password.length >= minLength + 4) return 2;
  return 1;
}

const SCORE_KEYS = ['weak', 'fair', 'strong', 'excellent'] as const;
const SCORE_WIDTH = ['w-1/4', 'w-2/4', 'w-3/4', 'w-full'];
const SCORE_TONE = ['bg-destructive', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-400'];

interface StrengthMeterProps {
  password: string;
  minLength: number;
}

function StrengthMeter({ password, minLength }: StrengthMeterProps) {
  const { t } = useLocale();
  if (!password) return null;
  const score = passwordScore(password, minLength);
  const label = t.auth.passwordStrength[SCORE_KEYS[score]];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-150 ease-out motion-reduce:transition-none ${SCORE_WIDTH[score]} ${SCORE_TONE[score]}`}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

interface FormState {
  email: string;
  username: string;
  displayName: string;
  password: string;
  confirmPassword: string;
  inviteCode: string;
  accepted: boolean;
}

const EMPTY: FormState = {
  email: '',
  username: '',
  displayName: '',
  password: '',
  confirmPassword: '',
  inviteCode: '',
  accepted: false,
};

/** Registration view — same container as sign-in, no route change (spec §2.8). */
export default function RegisterForm({ meta, onBack }: RegisterFormProps) {
  const { t } = useLocale();
  const { register, pending } = useSession();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const minLength = meta.passwordPolicy.minLength || 10;

  const patch = (key: keyof FormState, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.email.trim()) errors.email = t.auth.error.required;
    else if (!form.email.includes('@')) errors.email = t.auth.identifier.label;
    if (!form.password) errors.password = t.auth.error.required;
    else if (form.password.length < minLength) errors.password = t.auth.error.weakPassword;
    if (form.confirmPassword !== form.password) {
      errors.confirmPassword = t.auth.error.passwordMismatch;
    }
    if (!form.accepted) errors.terms = t.auth.error.termsRequired;
    if (meta.inviteRequired && !form.inviteCode.trim()) {
      errors.inviteCode = t.auth.error.required;
    }
    return errors;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setFailure(null);
    try {
      await register({
        email: form.email.trim(),
        password: form.password,
        username: form.username.trim() || undefined,
        displayName: form.displayName.trim() || undefined,
        inviteCode: meta.inviteRequired ? form.inviteCode.trim() : undefined,
      });
    } catch (error) {
      const failure = toAuthFailure(error);
      // The double-submit guard raising `auth_busy` is the protector working, not a
      // user-facing failure: showing "something went wrong" for one Enter keypress
      // held down twice is how a working form looks broken.
      if (failure.code === 'auth_busy') return;
      setFailure(failure);
    }
  };

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <p className="mt-1.5 text-xs text-destructive">{fieldErrors[key]}</p>
    ) : null;
  const errorText = failure ? t.auth.error[authErrorCopyKey(failure.code, failure.details)] : null;

  return (
    <form
      onSubmit={handleSubmit}
      className={`space-y-4 ${pending ? 'pointer-events-none' : ''}`}
      noValidate
    >
      <div>
        <label className={LABEL} htmlFor="register-email">
          {t.auth.identifier.label}
        </label>
        <input
          id="register-email"
          type="email"
          autoFocus
          autoComplete="email"
          className={INPUT}
          value={form.email}
          onChange={(event) => patch('email', event.target.value)}
        />
        {fieldError('email')}
      </div>

      <div>
        <label className={LABEL} htmlFor="register-username">
          {t.auth.username.label}
        </label>
        <input
          id="register-username"
          type="text"
          autoComplete="username"
          className={INPUT}
          value={form.username}
          onChange={(event) => patch('username', event.target.value)}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="register-display-name">
          {t.auth.displayName.label}
        </label>
        <input
          id="register-display-name"
          type="text"
          autoComplete="name"
          className={INPUT}
          value={form.displayName}
          onChange={(event) => patch('displayName', event.target.value)}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="register-password">
          {t.auth.password.label}
        </label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          className={INPUT}
          value={form.password}
          onChange={(event) => patch('password', event.target.value)}
        />
        <StrengthMeter password={form.password} minLength={minLength} />
        {fieldError('password')}
      </div>

      <div>
        <label className={LABEL} htmlFor="register-confirm">
          {t.auth.confirmPassword.label}
        </label>
        <input
          id="register-confirm"
          type="password"
          autoComplete="new-password"
          className={INPUT}
          value={form.confirmPassword}
          onChange={(event) => patch('confirmPassword', event.target.value)}
        />
        {fieldError('confirmPassword')}
      </div>

      {meta.inviteRequired && (
        <div>
          <label className={LABEL} htmlFor="register-invite">
            {t.auth.invite.label}
          </label>
          <input
            id="register-invite"
            type="text"
            className={INPUT}
            value={form.inviteCode}
            aria-describedby="register-invite-hint"
            onChange={(event) => patch('inviteCode', event.target.value)}
          />
          <p id="register-invite-hint" className="mt-1.5 text-[11px] text-muted-foreground">
            {t.auth.invite.hint}
          </p>
          {fieldError('inviteCode')}
        </div>
      )}

      <div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 rounded border-border bg-input accent-primary"
            checked={form.accepted}
            onChange={(event) => patch('accepted', event.target.checked)}
          />
          {t.auth.terms.accept}
        </label>
        {fieldError('terms')}
      </div>

      <div aria-live="polite">
        {errorText && (
          <div
            role="alert"
            className="rounded-lg border border-destructive-a/40 bg-destructive-a/10 px-3 py-2 text-xs text-destructive"
          >
            {errorText}
          </div>
        )}
      </div>

      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? t.auth.submitting : t.auth.createAccount}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        {t.auth.backToLogin}
      </button>
    </form>
  );
}
