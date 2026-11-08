'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import { accountCenterUrl, offlineDaysLeft, type SessionInfo } from '@/lib/api/authBridge';
import AccountCentreDialog from './AccountCentreDialog';
import { flushAllPending } from '@/components/video/projects/autosaveRegistry';
import ChangePasswordDialog from './ChangePasswordDialog';

const MENU_ITEM =
  'w-full px-3 py-2 text-left text-sm text-popover-foreground hover:bg-accent rounded-md ' +
  'transition-colors duration-150 ease-out flex items-center justify-between gap-2 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}

function formatTimestamp(iso: string, locale: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  return new Date(at).toLocaleString(locale);
}

type DevicesState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; items: SessionInfo[]; currentId: string };

interface DevicesPanelProps {
  state: DevicesState;
  pending: boolean;
  onReload: () => void;
  onRevoke: (id: string) => void;
}

/** "My devices": current device is labelled and its revoke button is inert. */
function DevicesPanel({ state, pending, onReload, onRevoke }: DevicesPanelProps) {
  const { t, locale } = useLocale();

  if (state.phase === 'loading') {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t.auth.devices.title}…</p>;
  }
  if (state.phase === 'error') {
    return (
      <div className="px-3 py-2">
        <p className="text-xs text-destructive">{t.auth.devices.unreachable}</p>
        <button type="button" onClick={onReload} className={`${MENU_ITEM} mt-1`}>
          {t.auth.retry}
        </button>
      </div>
    );
  }
  if (state.phase !== 'ready' || state.items.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{t.auth.devices.empty}</p>;
  }

  return (
    <ul className="max-h-64 overflow-y-auto py-1" aria-label={t.auth.devices.title}>
      {state.items.map((item) => {
        const isCurrent = item.current || item.id === state.currentId;
        return (
          <li key={item.id} className="px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-popover-foreground">
                {item.deviceName || item.platform || item.id}
              </span>
              {isCurrent && (
                <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-500">
                  {t.auth.devices.current}
                </span>
              )}
              {/* Revoking yourself succeeds server-side (200) and signs you out;
                  the button is disabled here only as a convenience. */}
              <button
                type="button"
                onClick={() => onRevoke(item.id)}
                disabled={pending || isCurrent}
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive-a/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.auth.devices.revoke}
              </button>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {[item.platform, item.appVersion, formatTimestamp(item.lastSeenAt, locale)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Title-bar account capsule + dropdown (spec §2.8, AC-04).
 *
 * Rendered through `AppTitleBar`'s `sessionSlot`, i.e. inside the `no-drag`
 * command zone — otherwise the frameless window's drag strip would swallow
 * every click. All account-server work goes through the main process; this
 * component never fetches, which is what AC-04 measures.
 *
 * Source badges live here as well because "offline mode" and "local
 * administrator" are properties of the session, and the capsule is the one
 * persistent session surface after sign-in.
 */
export default function AccountMenu() {
  const { t, locale } = useLocale();
  const {
    status,
    pending,
    logout,
    listSessions,
    revokeSession,
    openExternal,
  } = useSession();
  const [open, setOpen] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [showAccountCentre, setShowAccountCentre] = useState(false);
  const [devices, setDevices] = useState<DevicesState>({ phase: 'idle' });
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setShowDevices(false);
    setConfirmLogout(false);
    setHint(null);
  }, []);

  /** Open the embedded account centre (the browser stays one click away). */
  const openAccountCentre = () => {
    closeMenu();
    setShowAccountCentre(true);
  };

  const loadDevices = useCallback(async () => {
    setDevices({ phase: 'loading' });
    try {
      const result = await listSessions();
      setDevices({ phase: 'ready', items: result.items, currentId: result.currentId });
    } catch {
      setDevices({ phase: 'error' });
    }
  }, [listSessions]);

  const openDevices = () => {
    setShowDevices(true);
    setConfirmLogout(false);
    void loadDevices();
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeSession(id);
      await loadDevices();
    } catch {
      setHint(t.auth.devices.unreachable);
    }
  };

  const handleAccountCenter = async () => {
    const supportEmail = status.server?.supportEmail ?? '';
    const unavailable = fill(t.auth.accountCenter.unavailable, { email: supportEmail });
    if (!status.reachable || !status.server) {
      setHint(unavailable);
      return;
    }
    // Prefer the address this session actually talks to; `null` means "unknown",
    // and navigating anywhere else would be worse than saying so.
    const url = accountCenterUrl(status.server.baseUrl);
    if (!url) {
      setHint(unavailable);
      return;
    }
    try {
      await openExternal(url);
      closeMenu();
    } catch {
      setHint(unavailable);
    }
  };

  /**
   * Signing out unmounts the whole workspace (spec §2.12), so pending autosaves
   * are flushed first — the same registry the desktop close guard uses. A flush
   * failure must not block the sign-out: the user asked to leave.
   */
  const handleLogout = async () => {
    closeMenu();
    try {
      await flushAllPending(3000);
    } catch {
      // Fall through: the confirmation already warned about unsaved changes.
    }
    logout().catch(() => {});
  };

  const user = status.user;
  const isLocalRoot = status.source === 'local-root';
  const offlineDays = status.source === 'offline-cache'
    ? offlineDaysLeft(status.graceUntil)
    : null;
  const displayName = user?.displayName || user?.username || user?.email || t.auth.local.badge;
  const roleName = user?.role?.name ?? '';
  const initial = displayName.trim().slice(0, 1).toUpperCase();

  return (
    <div className="relative h-full flex items-center" ref={wrapperRef}>
      {isLocalRoot && (
        <span className="mr-1.5 rounded bg-destructive-a/15 px-1.5 py-0.5 text-[10px] text-destructive">
          {t.auth.local.badge}
        </span>
      )}
      {offlineDays !== null && (
        <span className="mr-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500">
          {`${t.auth.offline.badge} · ${fill(t.auth.offline.daysLeft, { days: offlineDays })}`}
        </span>
      )}

      <button
        type="button"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.auth.menu.label}
        className="flex items-center gap-1.5 h-7 rounded-md px-1.5 text-xs text-foreground hover:bg-accent transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-a/20 text-[10px] font-medium text-primary"
        >
          {initial}
        </span>
        <span className="max-w-[120px] truncate">{displayName}</span>
        {roleName && <span className="text-[10px] text-muted-foreground">{roleName}</span>}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-border bg-popover py-1 shadow-lg z-[10001]"
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="truncate text-xs text-popover-foreground">{user?.email ?? displayName}</p>
            {/* The only persistent session surface, so it is also the only place an
                unverified address is visible without opening the account centre. */}
            {user && !user.emailVerified && !isLocalRoot && (
              <p className="mt-0.5 text-[10px] text-amber-500">{t.auth.account.unverified}</p>
            )}
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {isLocalRoot ? t.auth.local.sessionNote : status.source ?? ''}
            </p>
            {status.source === 'offline-cache' && status.lastVerifiedAt && (
              <p className="mt-0.5 text-[10px] text-amber-500">
                {fill(t.auth.offline.lastVerified, {
                  time: formatTimestamp(status.lastVerifiedAt, locale),
                })}
              </p>
            )}
          </div>

          {showDevices ? (
            <div>
              <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t.auth.devices.title}
              </p>
              <DevicesPanel
                state={devices}
                pending={pending}
                onReload={() => void loadDevices()}
                onRevoke={(id) => void handleRevoke(id)}
              />
              <button
                type="button"
                onClick={() => setShowDevices(false)}
                className={MENU_ITEM}
              >
                {t.common.close}
              </button>
            </div>
          ) : (
            <div className="py-1">
              <button type="button" className={MENU_ITEM} onClick={openDevices}>
                {t.auth.menu.devices}
              </button>
              <button
                type="button"
                className={MENU_ITEM}
                onClick={() => {
                  closeMenu();
                  setShowChangePassword(true);
                }}
              >
                {t.auth.menu.changePassword}
              </button>
              <button type="button" className={MENU_ITEM} onClick={openAccountCentre}>
                {t.auth.account.title}
              </button>
              <button type="button" className={MENU_ITEM} onClick={() => void handleAccountCenter()}>
                {t.auth.account.openInBrowser}
              </button>
              {confirmLogout ? (
                <div className="px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-amber-500">
                    {t.auth.logoutConfirm}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      disabled={pending}
                      className="flex-1 h-8 rounded-md bg-destructive text-destructive-foreground text-xs hover:opacity-90 disabled:opacity-60"
                    >
                      {t.auth.menu.logout}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmLogout(false)}
                      className="flex-1 h-8 rounded-md border border-border text-xs text-foreground hover:bg-accent"
                    >
                      {t.common.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={MENU_ITEM}
                  onClick={() => setConfirmLogout(true)}
                >
                  {t.auth.menu.logout}
                </button>
              )}
            </div>
          )}

          {hint && (
            <p className="px-3 py-2 text-[11px] leading-relaxed text-amber-500" role="status">
              {hint}
            </p>
          )}
        </div>
      )}

      {showChangePassword && (
        <ChangePasswordDialog open onClose={() => setShowChangePassword(false)} />
      )}

      <AccountCentreDialog
        open={showAccountCentre}
        onClose={() => setShowAccountCentre(false)}
        onOpenBrowser={(url) => {
          // Already resolved against the runtime origin and inside the main
          // process allowlist; a rejection surfaces as the inline hint.
          void openExternal(url).catch(() => setHint(t.auth.account.browserUnavailable));
        }}
      />
    </div>
  );
}
