'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import GetCredentialLink from '@/components/integrations/GetCredentialLink';
import {
  formatLocalClock,
  fillTemplate,
  type SkillRouterStatus,
  type SkillRouterVerifyResult,
} from '@/lib/api/skillrouter';
import RouterVerifyResult from './RouterVerifyResult';

export type ConnectionState = 'connected' | 'unverified' | 'invalid' | 'unreachable';

/**
 * The pill is derived from the last verification the backend remembers (it
 * survives restarts, and is void after a key / base URL change): a key that was
 * never checked is "unverified", never "connected".
 */
export function deriveConnectionState(status: SkillRouterStatus): ConnectionState {
  switch (status.lastVerified?.outcome) {
    case 'ok':
      return 'connected';
    case 'invalid_credentials':
      return 'invalid';
    case 'unreachable':
    case 'upstream_error':
      return 'unreachable';
    default:
      return 'unverified';
  }
}

const PILL: Record<ConnectionState, { tone: string; icon: string }> = {
  connected: { tone: 'ok', icon: '✓' },
  unverified: { tone: 'neutral', icon: '○' },
  invalid: { tone: 'danger', icon: '✕' },
  unreachable: { tone: 'warn', icon: '▲' },
};

const HOUR_MS = 3_600_000;

/** "Verified 14:02", or "Last verified N h ago" for a record the backend is re-checking. */
export function describeCheckedAt(
  status: SkillRouterStatus,
  copy: { checkedAt: string; checkedAtStale: string },
  now: number = Date.now(),
): string | null {
  const verified = status.lastVerified;
  if (!verified) return null;
  if (!verified.stale) return fillTemplate(copy.checkedAt, { time: formatLocalClock(verified.at) });
  const hours = Math.max(1, Math.floor((now - verified.at) / HOUR_MS));
  return fillTemplate(copy.checkedAtStale, { hours: String(hours) });
}

export interface RouterConnectionCardProps {
  status: SkillRouterStatus;
  verifying: boolean;
  /** Latest verdict from "re-verify", shown inline until the next action. */
  verifyResult: SkillRouterVerifyResult | null;
  onReverify: () => void;
  onReplaceKey: () => void;
  onClearKey: () => void;
}

/** Saved-key summary: state pill, masked hint, and the four key actions. */
const RouterConnectionCard: React.FC<RouterConnectionCardProps> = ({
  status,
  verifying,
  verifyResult,
  onReverify,
  onReplaceKey,
  onClearKey,
}) => {
  const copy = useLocale().t.skillrouter.panel;
  const state = deriveConnectionState(status);
  const pill = PILL[state];
  const checkedAt = status.lastVerified?.at;
  const checkedLabel = describeCheckedAt(status, copy);
  return (
    <section className="sr-card" aria-label={copy.connectionTitle}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="sr-heading">{copy.connectionTitle}</h3>
          <p className="sr-text-xs sr-muted mt-1 font-mono">
            {copy.keyLabel} {status.keyHint ?? '—'}
          </p>
          <p className="sr-text-xs sr-muted mt-0.5 break-all font-mono">{status.baseUrl}</p>
        </div>
        <div className="text-right">
          <p className={`sr-pill sr-pill--${pill.tone}`} data-testid="connection-pill">
            <span aria-hidden="true">{pill.icon}</span>
            {copy.state[state]}
          </p>
          {checkedAt && checkedLabel && (
            <p className="sr-text-xs sr-muted mt-1">{checkedLabel}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="sr-btn"
          disabled={verifying}
          aria-busy={verifying || undefined}
          onClick={onReverify}
        >
          {verifying ? copy.verifying : copy.reverify}
        </button>
        <button type="button" className="sr-btn" onClick={onReplaceKey}>
          {copy.replaceKey}
        </button>
        <button type="button" className="sr-btn sr-btn--danger" onClick={onClearKey}>
          {copy.clearKey}
        </button>
        <GetCredentialLink
          id="skillrouter"
          label={copy.openConsole}
          showDocs={false}
          showActivation={false}
          className="ml-auto"
        />
      </div>
      {verifyResult && (
        <div className="mt-4">
          <RouterVerifyResult result={verifyResult} />
        </div>
      )}
    </section>
  );
};

export default RouterConnectionCard;
