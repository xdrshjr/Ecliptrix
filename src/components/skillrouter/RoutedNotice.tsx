'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapabilityId } from '@/lib/api/setupStatus';
import {
  ROUTED_CAPABILITIES,
  describeRouterFailure,
  isCapabilityRouted,
  type RoutedCapabilityId,
} from '@/lib/api/skillrouter';
import { useSkillRouter } from './useSkillRouter';

interface RoutedNoticeProps {
  /** `coding` is folded into `chat` by the gateway, so it is accepted too. */
  capability: CapabilityId | 'coding';
  className?: string;
}

function toRoutedCapability(capability: RoutedNoticeProps['capability']): RoutedCapabilityId | null {
  const id = capability === 'coding' ? 'chat' : capability;
  return ROUTED_CAPABILITIES.includes(id as RoutedCapabilityId) ? (id as RoutedCapabilityId) : null;
}

/**
 * Grey banner on the other settings panels: "served by the AI relay · use my
 * own configuration". Renders nothing unless the capability is routed right
 * now, so manual-mode users never see it. The panel's own data stays visible
 * underneath; the button only adds the capability to the "use my own" list.
 */
const RoutedNotice: React.FC<RoutedNoticeProps> = ({ capability, className = '' }) => {
  const { t } = useLocale();
  const copy = t.skillrouter.notice;
  const { status, save } = useSkillRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = toRoutedCapability(capability);

  if (!id || !isCapabilityRouted(status, id) || !status) return null;

  const switchToOwn = async () => {
    setBusy(true);
    setError(null);
    const result = await save({
      manualCapabilities: ROUTED_CAPABILITIES.filter(
        (item) => item === id || status.manualCapabilities.includes(item),
      ),
    });
    setBusy(false);
    if (!result.ok) setError(describeRouterFailure(result.error, t).title);
  };

  return (
    <div className={`sr-scope ${className}`}>
      <div
        role="note"
        className="sr-card sr-text-sm flex flex-wrap items-center justify-between gap-2"
        style={{ padding: '10px 14px' }}
      >
        <span className="sr-muted">
          <span aria-hidden="true">◈</span> {copy.routed}
        </span>
        <button
          type="button"
          className="sr-btn"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void switchToOwn()}
        >
          {busy ? copy.switching : copy.useOwn}
        </button>
      </div>
      {error && (
        <p role="alert" className="sr-text-xs mt-1" style={{ color: 'var(--sr-danger)' }}>
          ✕ {error}
        </p>
      )}
    </div>
  );
};

export default RoutedNotice;
