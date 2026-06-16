'use client';

import React, { useEffect, useId, useRef } from 'react';
import Image from 'next/image';
import { useLocale } from '@/contexts/LocaleContext';
import DesktopTitleBar from '@/components/desktop/DesktopTitleBar';
import { useLoginForm } from '@/components/auth/useLoginForm';

interface LoginScreenProps {
  /** Top notice selector. `session-expired` shows the "please log in again"
   *  banner. The gate is otherwise not closable (forced login). */
  reason?: 'session-expired' | null;
}

/** Visible, non-disabled focusable descendants, in DOM order. */
function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
}

/**
 * Full-window, non-closable login gate for the packaged desktop app (spec §6).
 *
 * Replaces the former silent auto-login: the desktop shell now lands here and
 * requires the user to type the configured root credentials. It owns the single
 * `DesktopTitleBar` for the unauthenticated state (spec §2.7 — the caller MUST
 * NOT render a second one), traps keyboard focus within the gate, and never
 * closes on Escape (the key difference from the closable web `LoginModal`).
 *
 * The username/password/validation/submit logic is shared with `LoginModal`
 * through `useLoginForm`; this component only adds the gate chrome and brand
 * hero panel.
 */
export default function LoginScreen({ reason = null }: LoginScreenProps) {
  const { t } = useLocale();
  const {
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
    submit,
  } = useLoginForm();

  const titleId = useId();
  const subtitleId = useId();
  const errorId = useId();
  const capsLockId = useId();

  const gateRef = useRef<HTMLDivElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  // Focus the username field on mount so the keyboard is immediately usable.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      usernameInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Trap Tab/Shift+Tab focus within the gate (form fields + title-bar window
  // controls). Escape is intentionally NOT handled — the gate cannot be closed
  // (spec §6.4). The trap spans the whole gate (not just the card) so the
  // frameless window's minimize/maximize/close stay keyboard-reachable.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !gateRef.current) return;
      const list = getFocusable(gateRef.current);
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active && !gateRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      ref={gateRef}
      className="fixed inset-0 z-[9999] flex flex-col bg-background"
    >
      {/* The single title bar for the unauthenticated state (spec §2.7). */}
      <DesktopTitleBar />

      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-auto p-4 sm:p-6">
        {/* Brand ambience: soft radial highlights layered over the themed
            background. Pointer-events-none so it never intercepts clicks; it
            adapts to dark mode via the themed token colors. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <div className="absolute -top-1/4 left-1/2 -translate-x-1/2 h-[42rem] w-[42rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-[-20%] right-[-10%] h-[34rem] w-[34rem] rounded-full bg-primary/5 blur-3xl" />
        </div>

        {reason === 'session-expired' && (
          <div
            role="alert"
            className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 text-sm shadow-sm"
          >
            {t.auth.sessionExpired}
          </div>
        )}

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitleId}
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 relative w-full max-w-4xl rounded-2xl border border-border bg-card/90 backdrop-blur shadow-2xl overflow-hidden"
        >
          <div className="flex flex-col lg:flex-row">
            {/* Brand hero — large screens only (spec §6.1). */}
            <div className="hidden lg:flex lg:flex-1 flex-col justify-between gap-10 bg-muted/60 p-12 border-r border-border">
              <div className="flex items-center gap-3">
                <Image
                  src="/logo-ai.png"
                  alt="Ecliptrix"
                  width={40}
                  height={40}
                  className="object-contain"
                  priority
                />
                <span className="text-xl font-semibold text-foreground tracking-tight">
                  Ecliptrix
                </span>
              </div>

              <div>
                <h3 className="text-3xl font-semibold text-foreground leading-tight">
                  {t.auth.welcomeTitle}
                </h3>
                <p className="mt-3 text-muted-foreground leading-relaxed">
                  {t.auth.loginTagline}
                </p>

                <ul className="mt-8 space-y-4">
                  {[t.auth.feature1, t.auth.feature2, t.auth.feature3].map((feature) => (
                    <li key={feature} className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" />
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-muted-foreground/70">
                {t.auth.welcomeSubtitle}
              </p>
            </div>

            {/* Login form. */}
            <div className="flex-1 p-8 sm:p-10 lg:p-12">
              <div className="max-w-sm mx-auto">
                {/* Compact brand mark for the single-column (mobile/small) layout. */}
                <div className="flex lg:hidden items-center justify-center gap-2 mb-8">
                  <Image
                    src="/logo-ai.png"
                    alt="Ecliptrix"
                    width={28}
                    height={28}
                    className="object-contain"
                    priority
                  />
                  <span className="text-lg font-semibold text-foreground">Ecliptrix</span>
                </div>

                <div className="mb-8">
                  <h2 id={titleId} className="text-2xl font-semibold text-foreground">
                    {t.auth.loginGateTitle}
                  </h2>
                  <p id={subtitleId} className="mt-2 text-sm text-muted-foreground">
                    {t.auth.loginGateSubtitle}
                  </p>
                </div>

                <form onSubmit={submit} noValidate className="space-y-5">
                  <div>
                    <label
                      htmlFor="login-username"
                      className="block text-sm font-medium text-muted-foreground mb-2"
                    >
                      {t.auth.username}
                    </label>
                    <input
                      id="login-username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      ref={usernameInputRef}
                      aria-invalid={!!error || undefined}
                      aria-describedby={error ? errorId : undefined}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full px-4 py-3 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors"
                      placeholder={t.auth.usernamePlaceholder}
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="block text-sm font-medium text-muted-foreground mb-2"
                    >
                      {t.auth.password}
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        aria-invalid={!!error || undefined}
                        aria-describedby={
                          [error ? errorId : null, capsLockOn ? capsLockId : null]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={onPasswordKeyEvent}
                        onKeyUp={onPasswordKeyEvent}
                        className="w-full px-4 py-3 pr-12 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors"
                        placeholder={t.auth.loginPasswordPlaceholder}
                      />
                      <button
                        type="button"
                        onClick={toggleShowPassword}
                        aria-pressed={showPassword}
                        aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                        className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring rounded-r-md"
                      >
                        {showPassword ? (
                          <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {capsLockOn && (
                      <p id={capsLockId} className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                        ⇪ {t.auth.capsLockOn}
                      </p>
                    )}
                  </div>

                  {error && (
                    <div
                      id={errorId}
                      role="alert"
                      aria-live="assertive"
                      aria-atomic="true"
                      className="p-3 bg-destructive/10 border border-destructive/20 rounded-md"
                    >
                      <p className="text-sm text-destructive">{error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="w-full py-3 bg-primary hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-md transition-opacity duration-200 flex items-center justify-center gap-2"
                  >
                    {isLoading && (
                      <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeDasharray="60 40"
                          className="opacity-75"
                        />
                      </svg>
                    )}
                    <span>{isLoading ? t.auth.loggingIn : t.auth.loginButton}</span>
                  </button>
                </form>

                {process.env.NEXT_PUBLIC_SHOW_DEV_HINTS === 'true' && (
                  <p className="mt-6 text-center text-xs text-muted-foreground">
                    Dev mode active — see deployment docs for the default account.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
