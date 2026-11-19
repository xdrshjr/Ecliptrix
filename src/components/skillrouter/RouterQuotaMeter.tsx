'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { fillTemplate, formatLocalClock, type RouterQuota } from '@/lib/api/skillrouter';

interface RouterQuotaMeterProps {
  quota: RouterQuota | null | undefined;
  className?: string;
}

/** Below this share of the daily allowance the bar turns to a warning. */
const LOW_QUOTA_RATIO = 0.1;

type MeterLevel = 'ok' | 'low' | 'empty';

function meterLevel(remaining: number, limit: number): MeterLevel {
  if (remaining <= 0) return 'empty';
  return remaining / limit <= LOW_QUOTA_RATIO ? 'low' : 'ok';
}

/**
 * Daily allowance bar. The reset time is shown in the user's time zone; the
 * gateway resets at 00:00 UTC, which is only mentioned in the hover text.
 * Renders nothing when the gateway reports no limit for the capability.
 */
const RouterQuotaMeter: React.FC<RouterQuotaMeterProps> = ({ quota, className = '' }) => {
  const copy = useLocale().t.skillrouter.quota;
  if (!quota || quota.dailyLimit === null || quota.dailyLimit <= 0) return null;

  const limit = quota.dailyLimit;
  const remaining = Math.max(0, Math.min(limit, quota.remaining ?? limit - (quota.used ?? 0)));
  const level = meterLevel(remaining, limit);
  const percent = Math.round((remaining / limit) * 100);
  const summary = fillTemplate(copy.remaining, {
    remaining: String(remaining),
    limit: String(limit),
    unit: quota.unit,
  }).trim();
  const status = level === 'empty' ? copy.exhausted : level === 'low' ? copy.low : null;

  return (
    <div className={`sr-text-xs ${className}`} title={copy.resetHint}>
      <div
        role="meter"
        aria-label={copy.label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={remaining}
        aria-valuetext={summary}
        className={`sr-meter ${level === 'ok' ? '' : `sr-meter--${level}`}`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="sr-muted mt-1 flex flex-wrap gap-x-2">
        <span>{summary}</span>
        {status && (
          <span
            style={{ color: level === 'empty' ? 'var(--sr-danger)' : 'var(--sr-warn)' }}
          >
            {level === 'empty' ? '✕' : '▲'} {status}
          </span>
        )}
        {quota.resetsAt !== null && (
          <span>{fillTemplate(copy.resetsAt, { time: formatLocalClock(quota.resetsAt) })}</span>
        )}
      </p>
    </div>
  );
};

export default RouterQuotaMeter;
