'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { ContextLevel, ContextUsageReading } from '@/components/video/hooks/contextUsage';
import type { UseContextMemoryReturn } from '@/components/video/hooks/useContextMemory';

/**
 * ContextRing — a 16 px ring plus percentage in the composer status row; its
 * popover shows token counts, the auto-compact switch and "Compact conversation".
 *
 * Spec: docs/plans/agent-research-crew-and-context-memory/spec.md §4.3.
 * The level is written out in the popover, never carried by colour alone.
 */

export interface ContextRingProps {
  percent: number;
  level: ContextLevel;
  reading: ContextUsageReading;
  isCompacting: boolean;
  /** False while a turn runs or a compaction is already in flight. */
  canCompact: boolean;
  autoCompact: boolean;
  onCompact: () => void;
  onToggleAutoCompact: (enabled: boolean) => void;
}

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TONE: Record<ContextLevel, string> = {
  ok: 'text-primary', notice: 'text-amber-500', warn: 'text-red-500', dropped: 'text-red-500',
};
const BUTTON = 'rounded border border-border px-2 py-1 text-xs hover:bg-accent '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary '
  + 'disabled:cursor-not-allowed disabled:opacity-50';

function formatTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

// Over 50 lines: one widget's JSX plus its open/close handling; splitting would only thread props.
const ContextRing: React.FC<ContextRingProps> = ({
  percent, level, reading, isCompacting, canCompact, autoCompact, onCompact, onToggleAutoCompact,
}) => {
  const { t } = useLocale();
  const copy = t.agentContext;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const label = copy.ring.label.replace('{pct}', String(percent));
  const urgent = level === 'warn' || level === 'dropped';

  // Focus leaving the whole widget (not just the button) closes the popover.
  const closeOnBlur = (event: React.FocusEvent) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={rootRef} className="relative" onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)} onBlur={closeOnBlur}>
      <button type="button" aria-label={label} aria-expanded={open} aria-controls={popoverId}
        onClick={() => setOpen(previous => !previous)}
        className={`flex items-center gap-1 rounded px-1 text-xs tabular-nums text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${isCompacting ? 'motion-safe:animate-pulse' : ''}`}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={TONE[level]}>
          <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" transform="rotate(-90 8 8)"
            strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`} />
        </svg>
        <span aria-hidden="true">{percent}%</span>
      </button>
      {open && (
        <div id={popoverId} role="dialog" aria-label={label}
          className="absolute bottom-full right-0 z-20 mb-1 w-60 space-y-2 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md">
          <p className="font-medium">{copy.level[level]}</p>
          <p className="tabular-nums text-muted-foreground">
            {copy.ring.tokens.replace('{used}', formatTokens(reading.usedTokens))
              .replace('{window}', formatTokens(reading.windowTokens))}
          </p>
          <label className="flex items-center justify-between gap-2">
            <span>{copy.autoCompact}</span>
            <input type="checkbox" role="switch" checked={autoCompact}
              onChange={event => onToggleAutoCompact(event.target.checked)} />
          </label>
          <button type="button" disabled={!canCompact} onClick={onCompact}
            className={`${BUTTON} w-full ${urgent && canCompact ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90' : ''}`}>
            {isCompacting ? copy.compacting : copy.compactNow}
          </button>
        </div>
      )}
    </div>
  );
};

/** The ring wired to `useContextMemory`; `onCompact` adds the user-facing notices. */
export const ConnectedContextRing: React.FC<{
  memory: UseContextMemoryReturn;
  onCompact: () => void;
}> = ({ memory, onCompact }) => (
  <ContextRing percent={memory.percent} level={memory.level} reading={memory.reading}
    isCompacting={memory.isCompacting} canCompact={memory.canCompact}
    autoCompact={memory.settings.autoCompact} onCompact={onCompact}
    onToggleAutoCompact={enabled => { void memory.setAutoCompact(enabled); }} />
);

export default ContextRing;
