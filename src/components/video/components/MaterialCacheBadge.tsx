'use client';

import React from 'react';
import type { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

/**
 * Compact status badge shown on the bottom-right of remote video material
 * cards. Reflects the lifecycle of `MaterialItem.cacheStatus` driven by
 * `useRemoteMaterialPrefetch`:
 *
 *   pending      → grey ring + spinner
 *   downloading  → ring filled by `downloadProgress`
 *   ready        → green check (auto-fades after 2s)
 *   failed       → red exclamation; tooltip carries `cacheError`,
 *                  click-to-retry calls `onRetry`
 *
 * The badge is a pure presentational component — the parent decides which
 * material to render and wires the retry handler. Hidden entirely when
 * `cacheStatus` is missing or 'idle' so non-remote materials don't show
 * any chrome.
 */
export interface MaterialCacheBadgeProps {
  material: Pick<
    MaterialItem,
    'id' | 'cacheStatus' | 'cacheError' | 'downloadProgress'
  >;
  /** Click handler for the failed state; receives the material id. */
  onRetry?: (materialId: string) => void;
  /** Hide the 'ready' state. Useful when the parent has its own checkmark. */
  hideReady?: boolean;
  /** Custom className for outer wrapper. */
  className?: string;
}

const SIZE = 22;

export const MaterialCacheBadge: React.FC<MaterialCacheBadgeProps> = ({
  material,
  onRetry,
  hideReady = false,
  className,
}) => {
  const { t } = useLocale();
  const status = material.cacheStatus;
  const [readyVisible, setReadyVisible] = React.useState(true);

  React.useEffect(() => {
    if (status !== 'ready') {
      setReadyVisible(true);
      return;
    }
    const id = setTimeout(() => setReadyVisible(false), 2000);
    return () => clearTimeout(id);
  }, [status]);

  if (!status || status === 'idle') return null;
  if (status === 'ready' && (hideReady || !readyVisible)) return null;

  const tooltip = (() => {
    switch (status) {
      case 'pending':
        return t.materialsPanel.cacheStatus.pending;
      case 'downloading':
        return t.materialsPanel.cacheStatus.downloading;
      case 'ready':
        return t.materialsPanel.cacheStatus.ready;
      case 'failed':
        return material.cacheError
          ? `${t.materialsPanel.cacheStatus.failed}: ${material.cacheError}`
          : t.materialsPanel.cacheStatus.failed;
      default:
        return '';
    }
  })();

  // SVG ring rendering — works on dark and light backgrounds without
  // depending on Tailwind compile state for runtime-coloured strokes.
  const radius = SIZE / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const progress =
    status === 'ready'
      ? 100
      : status === 'downloading'
        ? Math.max(10, material.downloadProgress ?? 60)
        : status === 'pending'
          ? 10
          : 0;
  const dashOffset = circumference * (1 - progress / 100);

  const isFailed = status === 'failed';
  const handleClick = isFailed && onRetry ? () => onRetry(material.id) : undefined;

  const ring = (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden="true"
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={radius}
        fill="rgba(0,0,0,0.45)"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={2}
      />
      {!isFailed && status !== 'ready' && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          fill="transparent"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: 'stroke-dashoffset 200ms linear' }}
        />
      )}
      {status === 'pending' && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={radius}
          fill="transparent"
          stroke="#3b82f6"
          strokeWidth={2}
          strokeDasharray="8 8"
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from={`0 ${SIZE / 2} ${SIZE / 2}`}
            to={`360 ${SIZE / 2} ${SIZE / 2}`}
            dur="1.2s"
            repeatCount="indefinite"
          />
        </circle>
      )}
      {status === 'ready' && (
        <path
          d="M6 12 L10 16 L17 8"
          fill="none"
          stroke="#22c55e"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {isFailed && (
        <>
          <line
            x1={SIZE / 2}
            y1={6}
            x2={SIZE / 2}
            y2={13}
            stroke="#ef4444"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
          <circle cx={SIZE / 2} cy={16} r={1.4} fill="#ef4444" />
        </>
      )}
    </svg>
  );

  return (
    <div
      role={isFailed ? 'button' : 'status'}
      title={
        isFailed
          ? `${tooltip} — ${t.materialsPanel.cacheStatus.retry}`
          : tooltip
      }
      aria-label={tooltip}
      onClick={handleClick}
      onKeyDown={
        isFailed && onRetry
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onRetry(material.id);
              }
            }
          : undefined
      }
      tabIndex={isFailed ? 0 : -1}
      className={
        'pointer-events-auto select-none' +
        (isFailed ? ' cursor-pointer hover:scale-110 transition-transform' : '') +
        (className ? ` ${className}` : '')
      }
      style={{ width: SIZE, height: SIZE }}
    >
      {ring}
    </div>
  );
};

export default MaterialCacheBadge;
