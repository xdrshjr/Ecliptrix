'use client';

/**
 * ApprovalBanner — the three human gates in one place (spec §4.5.3, D-BW2-7):
 * consent (first use of a profile's sign-ins), risky_action, handoff
 * (login / captcha handed back to the user).
 *
 * It sits IN FLOW above the viewport (`data-native-inflow`), so geometry never
 * overlaps the native view and it is exempt from occlusion detection. Focus
 * moves to the first button when it appears and returns to the previous element
 * when it goes away; Enter = allow once, Esc = deny.
 */

import React, { useEffect, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import type {
  BrowserApproval, BrowserApprovalDecision,
} from '@/types/browserWorkspace';

export interface ApprovalBannerProps {
  approval: BrowserApproval;
  profileName: string;
  onResolve(id: string, decision: BrowserApprovalDecision): void;
}

interface Choice {
  label: string;
  decision: BrowserApprovalDecision;
  primary?: boolean;
}

function useFocusRestore(rootRef: React.RefObject<HTMLElement | null>, key: string): void {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.querySelector<HTMLButtonElement>('button[data-autofocus]')?.focus();
    return () => {
      if (previous && document.body.contains(previous)) {
        try { previous.focus(); } catch { /* element may be gone */ }
      }
    };
  }, [rootRef, key]);
}

export default function ApprovalBanner({ approval, profileName, onResolve }: ApprovalBannerProps) {
  const { t } = useLocale();
  const copy = t.browserWorkspace;
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusRestore(rootRef, approval.id);

  const title = approval.kind === 'consent'
    ? fillCopy(copy.consent.title, { profile: profileName })
    : approval.kind === 'risky_action'
      ? fillCopy(copy.risky.title, {
        action: approval.target?.label ?? approval.reason, host: approval.target?.host ?? '',
      })
      : fillCopy(copy.handoff.title, { reason: approval.reason });
  const detail = approval.kind === 'consent'
    ? `${copy.consent.body} ${fillCopy(copy.consent.scope, { profile: profileName })}`
    : approval.kind === 'risky_action' ? approval.reason : '';
  const choices: Choice[] = approval.kind === 'consent'
    ? [
      { label: copy.approval.onlyThisRun, decision: 'approve', primary: true },
      { label: copy.approval.always, decision: 'approve_scope' },
      { label: copy.approval.deny, decision: 'deny' },
    ]
    : approval.kind === 'risky_action'
      ? [
        { label: copy.approval.allowOnce, decision: 'approve', primary: true },
        { label: copy.approval.allowScope, decision: 'approve_scope' },
        { label: copy.approval.deny, decision: 'deny' },
      ]
      : [
        { label: copy.approval.done, decision: 'approve', primary: true },
        { label: copy.approval.cancel, decision: 'deny' },
      ];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onResolve(approval.id, 'deny');
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      onResolve(approval.id, 'approve');
    }
  };
  const lifetime = Math.max(1000, approval.expiresAt - approval.createdAt);

  return (
    <div
      ref={rootRef}
      className="bw-approval"
      data-kind={approval.kind}
      data-native-inflow="true"
      role="alertdialog"
      aria-live="assertive"
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <div className="bw-approval-text">
        <p className="bw-approval-title">{title}</p>
        {detail && <p className="bw-approval-detail">{detail}</p>}
      </div>
      <div className="bw-approval-actions">
        {choices.map((choice, index) => (
          <button
            key={choice.decision}
            type="button"
            className={choice.primary ? 'bw-btn bw-btn-primary' : 'bw-btn'}
            data-autofocus={index === 0 ? 'true' : undefined}
            onClick={() => onResolve(approval.id, choice.decision)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <span className="bw-approval-timer" aria-hidden="true"
        style={{ animationDuration: `${lifetime}ms` }} />
    </div>
  );
}
