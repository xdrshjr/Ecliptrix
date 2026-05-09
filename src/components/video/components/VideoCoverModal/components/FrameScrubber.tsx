'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

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
 *
 * The native input is uncontrolled (`defaultValue` + ref-driven mirroring)
 * so programmatic value writes via the `HTMLInputElement.prototype.value`
 * descriptor + dispatched `input` events are honored — the controlled-input
 * variant swallowed those updates.
 */
export const FrameScrubber: React.FC<FrameScrubberProps> = ({
  totalDurationSec,
  valueSec,
  onChange,
  onCommit,
  disabled,
}) => {
  const { t } = useLocale();
  const tooltipId = useId();
  const [draftSec, setDraftSec] = useState(valueSec);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep ``draftSec`` in sync with external prop changes (e.g. template load).
  useEffect(() => {
    setDraftSec(valueSec);
  }, [valueSec]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const locked = disabled || totalDurationSec <= 0;
  const max = Math.max(0, totalDurationSec);

  // Mirror the latest draft into the uncontrolled native input so external
  // prop changes (template load, parent reset) are reflected without
  // re-rendering through React's value attribute.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const next = String(Math.min(max, Math.max(0, draftSec)));
    if (el.value !== next) el.value = next;
  }, [draftSec, max]);

  const labels = t.videoCoverModal?.scrubber ?? {
    tooltip: 'Drag to pick a frame',
    atTime: 'At {time}',
    noVideoItems: 'No video clips on the timeline',
  };
  const a11yLabel = t.videoCoverModal?.a11y?.frameSlider ?? labels.tooltip;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span id={tooltipId}>{locked ? labels.noVideoItems : labels.tooltip}</span>
        <span className="tabular-nums">
          {locked ? '—' : labels.atTime.replace('{time}', formatTime(draftSec))}
        </span>
      </div>
      <input
        ref={inputRef}
        type="range"
        aria-labelledby={tooltipId}
        aria-label={a11yLabel}
        aria-valuetext={
          locked ? labels.noVideoItems : labels.atTime.replace('{time}', formatTime(draftSec))
        }
        min={0}
        max={max}
        step={0.05}
        defaultValue={String(Math.min(max, Math.max(0, valueSec)))}
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
