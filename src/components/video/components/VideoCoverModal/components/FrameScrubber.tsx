'use client';

import React, { useEffect, useRef, useState } from 'react';

import { useLocale } from '@/contexts/LocaleContext';

interface FrameScrubberProps {
  totalDurationSec: number;
  valueSec: number;
  onChange: (valueSec: number) => void;
  /** Fired after a debounce — used to trigger the (expensive) frame extraction. */
  onCommit: (valueSec: number) => void;
  disabled?: boolean;
}

const DEBOUNCE_MS = 200;

/**
 * Range slider over the virtual timeline. Locked when ``totalDurationSec``
 * is 0 (no video items on the timeline — the parent then auto-flips the
 * source toggle to "Upload"). Frame extraction is debounced 200 ms to
 * keep the scrubber smooth.
 */
export const FrameScrubber: React.FC<FrameScrubberProps> = ({
  totalDurationSec,
  valueSec,
  onChange,
  onCommit,
  disabled,
}) => {
  const { t } = useLocale();
  const [draftSec, setDraftSec] = useState(valueSec);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ``draftSec`` in sync with external prop changes (e.g. template
  // load).
  useEffect(() => {
    setDraftSec(valueSec);
  }, [valueSec]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const locked = disabled || totalDurationSec <= 0;
  const max = Math.max(0, totalDurationSec);

  const labels = t.videoCoverModal?.scrubber ?? {
    tooltip: 'Drag to pick a frame',
    atTime: 'At {time}',
    noVideoItems: 'No video clips on the timeline',
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{locked ? labels.noVideoItems : labels.tooltip}</span>
        <span className="tabular-nums">
          {locked ? '—' : labels.atTime.replace('{time}', formatTime(draftSec))}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={Math.min(max, Math.max(0, draftSec))}
        disabled={locked}
        className="w-full disabled:opacity-50"
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value);
          if (!Number.isFinite(v)) return;
          setDraftSec(v);
          onChange(v);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            onCommit(v);
          }, DEBOUNCE_MS);
        }}
      />
    </div>
  );
};

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default FrameScrubber;
