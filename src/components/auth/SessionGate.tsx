'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useSession } from '@/contexts/SessionContext';
import AuthTitleBar from './AuthTitleBar';
import LoginScreen from './LoginScreen';
import AccountDeletedScreen from './AccountDeletedScreen';
import AuthBlocker from './AuthBlocker';
import ChangePasswordDialog from './ChangePasswordDialog';

interface Notice {
  tone: 'danger' | 'warning';
  text: string;
}

const NOTICE_TONE: Record<Notice['tone'], string> = {
  danger: 'bg-destructive-a/15 text-destructive border-b border-destructive-a/40',
  warning: 'bg-amber-500/15 text-amber-500 border-b border-amber-500/40',
};

/**
 * Status-strip rules (spec §2.8 / §2.13).
 *
 * The red "gate is off" bar is only ever raised by an explicit main-process
 * warning (`securityWarning === 'gate-disabled'`, i.e. `ECLIPTRIX_AUTH_GATE=off`).
 * Everything else that merely *runs without a gate* — `desktop/ npm run dev`,
 * a plain browser at `:3000` — gets the amber development notice, so an
 * operator never sees a red emergency bar during normal development.
 */
function useGateNotices(): Notice[] {
  const { t } = useLocale();
  const { status } = useSession();
  const notices: Notice[] = [];
  if (status.securityWarning === 'plaintext-session') {
    notices.push({ tone: 'warning', text: t.auth.session.plaintext });
  }
  if (status.securityWarning === 'gate-disabled') {
    notices.push({ tone: 'danger', text: t.auth.gateDisabled.badge });
  } else if (status.source === 'gate-disabled') {
    notices.push({ tone: 'warning', text: t.auth.dev.badge });
  }
  return notices;
}

function GateNotices() {
  const notices = useGateNotices();
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col">
      {notices.map((notice) => (
        <div
          key={notice.tone}
          role="status"
          aria-live="polite"
          className={`px-3 py-1.5 text-xs ${NOTICE_TONE[notice.tone]}`}
        >
          {notice.text}
        </div>
      ))}
    </div>
  );
}

/**
 * Cold-start placeholder: the same 40px drag bar plus a centered 12px skeleton
 * (`h-3`). Server and first client frame both render exactly this, so the gate
 * cannot cause a hydration mismatch — `booting` is the initial state on both
 * sides.
 */
function BootSkeleton() {
  return (
    <div
      className="flex-1 flex items-center justify-center bg-background"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-2 animate-pulse motion-reduce:animate-none">
        <div className="h-3 w-12 rounded-full bg-muted" />
        <div className="h-3 w-8 rounded-full bg-muted-a/70" />
      </div>
    </div>
  );
}

interface PreAuthFrameProps {
  appVersion: string;
  children: React.ReactNode;
}

/** Shared chrome for booting / unauthenticated / blocked: drag bar + notices. */
function PreAuthFrame({ appVersion, children }: PreAuthFrameProps) {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <AuthTitleBar appVersion={appVersion} />
      <GateNotices />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
    </div>
  );
}

interface SessionGateProps {
  children: React.ReactNode;
}

/**
 * Renders exactly one of the four identity states (spec §2.7) and is the only
 * place that decides what a signed-out user may see.
 *
 * `authenticated` renders `children` untouched — the workspace keeps owning the
 * full window — with the status strips laid over the title bar area, because a
 * layout-level strip would shift the editor by its own height.
 */
export default function SessionGate({ children }: SessionGateProps) {
  const { status, urlReason } = useSession();

  if (status.state === 'booting') {
    return (
      <PreAuthFrame appVersion={status.appVersion}>
        <BootSkeleton />
      </PreAuthFrame>
    );
  }

  if (status.state === 'unauthenticated') {
    // A closed account gets its own screen, never the sign-in form: the form is
    // reachable by anyone, and "this account was deleted" there is the
    // "this-address-existed" oracle (spec P1-5). This state is only ever produced
    // by a session the main process had already authenticated.
    const deleted = status.reason === 'account-deleted';
    return (
      <PreAuthFrame appVersion={status.appVersion}>
        {deleted ? <AccountDeletedScreen /> : <LoginScreen reason={status.reason ?? urlReason} />}
      </PreAuthFrame>
    );
  }

  if (status.state === 'blocked') {
    return (
      <PreAuthFrame appVersion={status.appVersion}>
        <AuthBlocker />
      </PreAuthFrame>
    );
  }

  return (
    <div className="h-screen overflow-hidden">
      <div className="fixed top-10 inset-x-0 z-[9999] flex flex-col">
        <GateNotices />
      </div>
      {children}
      {status.mustChangePassword && <ChangePasswordDialog open />}
    </div>
  );
}
