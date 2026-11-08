'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import { authErrorCopyKey, toAuthFailure, type AuthFailure } from '@/lib/api/authBridge';
import { trapTabKey } from '@/components/ui/focusTrap';

interface ChangePasswordDialogProps {
  open: boolean;
  /**
   * Closing path. Absent means "forced": the gate mounts this dialog while
   * `mustChangePassword` is true and the only way out is signing out
   * (spec AC-13: the renderer forces it, the main process narrows IPC).
   */
  onClose?: () => void;
}

const INPUT =
  'w-full h-11 rounded-lg border border-border bg-input px-3 text-sm text-foreground ' +
  'placeholder:text-muted-foreground transition-shadow duration-150 ease-out ' +
  'focus:outline-none focus:ring-2 focus:ring-accent-a/40 motion-reduce:transition-none';
const LABEL = 'block text-xs font-medium text-muted-foreground mb-1.5';
const PRIMARY_BUTTON =
  'w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-medium ' +
  'transition-opacity duration-150 ease-out hover:opacity-90 disabled:opacity-60 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';
const SECONDARY_BUTTON =
  'w-full h-11 rounded-lg border border-border bg-muted text-sm text-foreground ' +
  'transition-colors duration-150 ease-out hover:bg-accent disabled:opacity-60 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

/** Mandatory / voluntary password change. */
export default function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const { t } = useLocale();
  const { changePassword, logout, pending } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [signOutOtherSessions, setSignOutOtherSessions] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const forced = !onClose;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLInputElement>('input');
      first?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || !currentPassword || !newPassword) return;
    setFailure(null);
    try {
      await changePassword({ currentPassword, newPassword, signOutOtherSessions });
      setCurrentPassword('');
      setNewPassword('');
      onClose?.();
    } catch (error) {
      const failure = toAuthFailure(error);
      // The double-submit guard raising `auth_busy` is the protector working, not a
      // user-facing failure: showing "something went wrong" for one Enter keypress
      // held down twice is how a working form looks broken.
      if (failure.code === 'auth_busy') return;
      setFailure(failure);
    }
  };

  const handleLogout = () => {
    logout().catch(() => {});
  };

  const errorText = failure ? t.auth.error[authErrorCopyKey(failure.code, failure.details)] : null;

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 px-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.auth.changePassword.title}
        tabIndex={-1}
        onKeyDown={(event) => {
          trapTabKey(event, dialogRef.current);
          if (event.key === 'Escape' && !forced) {
            event.preventDefault();
            onClose?.();
          }
        }}
        className="w-full max-w-[380px] rounded-xl border border-border bg-popover p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">{t.auth.changePassword.title}</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
          <div>
            <label className={LABEL} htmlFor="change-current">
              {t.auth.changePassword.current}
            </label>
            <input
              id="change-current"
              type="password"
              autoComplete="current-password"
              className={INPUT}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="change-new">
              {t.auth.changePassword.new}
            </label>
            <input
              id="change-new"
              type="password"
              autoComplete="new-password"
              className={INPUT}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border bg-input accent-primary"
              checked={signOutOtherSessions}
              onChange={(event) => setSignOutOtherSessions(event.target.checked)}
            />
            {t.auth.changePassword.signOutOthers}
          </label>

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

          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {pending ? t.auth.submitting : t.auth.submit}
          </button>
        </form>

        <div className="mt-2">
          {forced ? (
            <button type="button" onClick={handleLogout} className={SECONDARY_BUTTON}>
              {t.auth.menu.logout}
            </button>
          ) : (
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
              {t.common.cancel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
