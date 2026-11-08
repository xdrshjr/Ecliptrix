'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import {
  accountCenterUrl,
  type ActivityItem,
  type MeView,
  type SessionInfo,
} from '@/lib/api/authBridge';
import { useLocale } from '@/contexts/LocaleContext';
import { trapTabKey } from '@/components/ui/focusTrap';
import { translations } from '@/lib/i18n';

/**
 * The desktop account centre.
 *
 * Four tabs over the identity the main process already holds. Two rules shape it:
 *
 *  1. **It never invents state.** Every value shown comes from `auth:me`,
 *     `auth:list-sessions` or `auth:activity`; a failed read shows an error, not a
 *     remembered value.
 *  2. **It degrades per METHOD.** An older main process ships the bridge without
 *     `me`/`updateProfile`/`activity`/`resendVerification`. The capabilities probe
 *     decides which controls exist, so nothing throws at click time — the missing
 *     ones are simply not rendered (spec §3.10 / P1-7).
 *
 * The dialog is keyboard first: Escape closes, the tab list is a real `tablist`
 * with arrow-key movement, and focus returns to the trigger on close.
 */

type TabKey = 'profile' | 'devices' | 'security' | 'activity';

/** Format a relative time without pulling a date library in (client-only). */
function relative(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Action label for one activity row.
 *
 * Unknown actions fall back to the raw string: an unlabelled row is better than a
 * blank one, and it makes a missing translation visible instead of silent.
 */
function actionLabel(action: string): string {
  return action
    .replace(/^auth\./, '')
    .replace(/^account\./, '')
    .replace(/^user\./, '')
    .replace(/_/g, ' ');
}

export interface AccountCentreDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user asks to open the web centre (already URL-checked). */
  onOpenBrowser: (url: string) => void;
}

export default function AccountCentreDialog({
  open,
  onClose,
  onOpenBrowser,
}: AccountCentreDialogProps) {
  const {
    status,
    capabilities,
    me,
    updateProfile,
    activity,
    resendVerification,
    listSessions,
    revokeSession,
  } = useSession();
  const { locale } = useLocale();
  const t = translations[locale].auth;
  const copy = t.account;

  const [tab, setTab] = useState<TabKey>('profile');
  const [view, setView] = useState<MeView | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [activityRows, setActivityRows] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [savedHint, setSavedHint] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    profile: null,
    devices: null,
    security: null,
    activity: null,
  });

  /** The four tabs this build can actually serve. */
  const tabs = useMemo(() => {
    const list: TabKey[] = [];
    if (capabilities.me) list.push('profile');
    list.push('devices');
    list.push('security');
    if (capabilities.activity) list.push('activity');
    return list;
  }, [capabilities.me, capabilities.activity]);

  // Load the profile once per open. The renderer never caches it across sessions.
  useEffect(() => {
    if (!open || !capabilities.me) return;
    let active = true;
    setError(null);
    setView(null);
    me()
      .then((next) => {
        if (!active) return;
        setView(next);
        setDisplayName(next.displayName);
      })
      .catch(() => {
        if (active) setError(copy.failed);
      });
    return () => {
      active = false;
    };
  }, [open, capabilities.me, me, copy.failed]);

  // Devices load when the tab is first opened, not on mount: a dialog opened for
  // the profile should not spend a request on a list nobody looked at.
  useEffect(() => {
    if (!open || tab !== 'devices' || sessions !== null) return;
    let active = true;
    listSessions()
      .then((result) => {
        if (active) setSessions(result.items);
      })
      .catch(() => {
        if (active) setError(copy.failed);
      });
    return () => {
      active = false;
    };
  }, [open, tab, sessions, listSessions, copy.failed]);

  useEffect(() => {
    if (!open || tab !== 'activity' || activityRows !== null || !capabilities.activity) return;
    let active = true;
    activity()
      .then((result) => {
        if (active) setActivityRows(result.items);
      })
      .catch(() => {
        if (active) setError(copy.failed);
      });
    return () => {
      active = false;
    };
  }, [open, tab, activityRows, capabilities.activity, activity, copy.failed]);

  // Escape closes; focus moves into the dialog on open, stays inside it, and goes
  // back to whatever opened it.
  //
  // `aria-modal="true"` is a claim, not an implementation: without the Tab trap the
  // focus walks the editor behind the overlay, and without the restore the user is
  // dropped on `<body>` after closing (the same handling `ChangePasswordDialog`
  // already had).
  useEffect(() => {
    if (!open) return;
    const trigger = typeof document !== 'undefined' ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    const focusTimer = window.setTimeout(() => {
      const first = tabRefs.current[tab] ?? dialogRef.current;
      first?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      window.clearTimeout(focusTimer);
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [open, onClose, tab]);

  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, current: TabKey) => {
      const index = tabs.indexOf(current);
      if (index < 0) return;
      let nextIndex = index;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      const next = tabs[nextIndex];
      setTab(next);
      tabRefs.current[next]?.focus();
    },
    [tabs],
  );

  const saveProfile = async () => {
    if (!capabilities.updateProfile) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateProfile({ displayName });
      setView(next);
      setSavedHint(copy.profile.saved);
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!capabilities.resendVerification) return;
    setBusy(true);
    try {
      await resendVerification();
      setSavedHint(copy.resent);
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await revokeSession(id);
      const result = await listSessions();
      setSessions(result.items);
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  };

  /** Runtime origin first; `null` means "unknown", so the affordance is disabled. */
  const browserUrl = accountCenterUrl(status.server?.baseUrl ?? '');

  if (!open) return null;

  const user = view ?? null;
  const degraded = !capabilities.me;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-centre-title"
        tabIndex={-1}
        onKeyDown={(event) => trapTabKey(event, dialogRef.current)}
        className="w-full max-w-2xl rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <h2 id="account-centre-title" className="text-sm font-medium">
            {copy.title}
          </h2>
          <button
            type="button"
            aria-label={copy.close}
            className="rounded-sm p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={onClose}
          >
            <span aria-hidden="true">&#10005;</span>
          </button>
        </header>

        {degraded && (
          <p className="border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-2 text-xs text-[var(--muted)]">
            {copy.degraded}
          </p>
        )}

        <div role="tablist" aria-label={copy.title} className="flex gap-1 border-b border-[var(--border)] px-3">
          {tabs.map((key) => (
            <button
              key={key}
              ref={(node) => {
                tabRefs.current[key] = node;
              }}
              role="tab"
              id={`account-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`account-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              onKeyDown={(event) => onTabKeyDown(event, key)}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs transition-colors ${
                tab === key
                  ? 'border-[var(--accent)] text-[var(--foreground)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {copy.tabs[key]}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm">
          {error && (
            <p role="alert" className="mb-3 rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-xs text-[var(--danger)]">
              {error}
            </p>
          )}
          {savedHint && (
            <p role="status" className="mb-3 text-xs text-[var(--accent)]">
              {savedHint}
            </p>
          )}

          {tab === 'profile' && (
            <div role="tabpanel" id="account-panel-profile" aria-labelledby="account-tab-profile">
              {!capabilities.me && (
                <p className="text-xs text-[var(--muted)]">{copy.degraded}</p>
              )}
              {capabilities.me && !user && !error && (
                <p className="text-xs text-[var(--muted)]">{copy.loading}</p>
              )}
              {user && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{user.email}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {user.role.name || user.role.key}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs ${
                        user.emailVerified
                          ? 'border-[var(--accent)]/40 text-[var(--accent)]'
                          : 'border-[var(--warning)]/40 text-[var(--warning)]'
                      }`}
                    >
                      <span aria-hidden="true">{user.emailVerified ? '\u2713' : '!'}</span>
                      {user.emailVerified ? copy.verified : copy.unverified}
                    </span>
                  </div>

                  {!user.emailVerified && (
                    <div className="rounded-sm border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2">
                      <p className="text-xs text-[var(--warning)]">
                        {copy.unverifiedHint.replace('{email}', user.email)}
                      </p>
                      {capabilities.resendVerification && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resend()}
                          className="mt-1 text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                        >
                          {copy.resend}
                        </button>
                      )}
                    </div>
                  )}

                  {user.pendingEmail && (
                    <p className="text-xs text-[var(--muted)]">
                      {copy.pendingEmail.replace('{email}', user.pendingEmail)}
                    </p>
                  )}

                  {user.deletion && (
                    <p className="flex items-center gap-1 text-xs text-[var(--danger)]">
                      <span aria-hidden="true">!</span>
                      {user.deletion.status === 'scheduled'
                        ? copy.deletion.scheduled.replace(
                            '{date}',
                            user.deletion.scheduledFor ?? '',
                          )
                        : copy.deletion.requested}
                    </p>
                  )}

                  {capabilities.updateProfile ? (
                    <div className="flex items-end gap-2">
                      <label className="flex-1 text-xs text-[var(--muted)]">
                        {t.displayName.label}
                        <input
                          value={displayName}
                          maxLength={64}
                          onChange={(event) => setDisplayName(event.target.value)}
                          className="mt-1 w-full rounded-sm border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy || displayName.trim() === ''}
                        onClick={() => void saveProfile()}
                        className="rounded-sm bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-foreground)] disabled:opacity-50"
                      >
                        {copy.profile.saved}
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">{copy.profile.emailManaged}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'devices' && (
            <div role="tabpanel" id="account-panel-devices" aria-labelledby="account-tab-devices">
              {sessions === null && <p className="text-xs text-[var(--muted)]">{copy.loading}</p>}
              {sessions !== null && sessions.length === 0 && (
                <p className="text-xs text-[var(--muted)]">{t.devices.empty}</p>
              )}
              <ul className="flex flex-col gap-2">
                {(sessions ?? []).map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-sm border border-[var(--border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs">
                        {item.deviceName || item.platform || item.client}
                        {item.current && (
                          <span className="ml-2 text-2xs text-[var(--accent)]">
                            {t.devices.current}
                          </span>
                        )}
                      </p>
                      <p className="text-2xs text-[var(--muted)]">
                        {item.ip} · {relative(item.lastSeenAt)}
                      </p>
                    </div>
                    {!item.current && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void revoke(item.id)}
                        className="text-xs text-[var(--danger)] hover:underline disabled:opacity-50"
                      >
                        {t.devices.revoke}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'security' && (
            <div role="tabpanel" id="account-panel-security" aria-labelledby="account-tab-security">
              <p className="text-xs text-[var(--muted)]">
                {user?.emailVerified ? copy.verified : copy.unverified}
              </p>
            </div>
          )}

          {tab === 'activity' && (
            <div role="tabpanel" id="account-panel-activity" aria-labelledby="account-tab-activity">
              {activityRows !== null && activityRows.length === 0 && (
                <p className="text-xs text-[var(--muted)]">{copy.activity.empty}</p>
              )}
              <ul className="flex flex-col gap-1">
                {(activityRows ?? []).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate">{actionLabel(item.action)}</span>
                    <span className="mono shrink-0 text-2xs text-[var(--muted)]">
                      {item.ipMasked} · {relative(item.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {activityRows !== null && activityRows.length > 0 && (
                <p className="mt-2 text-2xs text-[var(--muted)]">{copy.activity.more}</p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            disabled={!browserUrl}
            title={browserUrl ? undefined : copy.browserUnavailable}
            onClick={() => {
              if (browserUrl) onOpenBrowser(browserUrl);
            }}
            className="text-xs text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--muted)] disabled:no-underline"
          >
            {browserUrl ? copy.openInBrowser : copy.browserUnavailable}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-[var(--border-strong)] px-3 py-1.5 text-xs"
          >
            {copy.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
