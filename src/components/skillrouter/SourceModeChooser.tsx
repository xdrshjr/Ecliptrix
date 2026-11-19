'use client';

import React, { useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { RouterMode } from '@/lib/api/skillrouter';

interface SourceModeChooserProps {
  /** `null` until a source was ever chosen (fresh install). */
  value: RouterMode | null;
  onChange: (mode: RouterMode) => void;
  disabled?: boolean;
  /** Drops the bullet points; used where space is tight. */
  compact?: boolean;
}

const MODES: readonly RouterMode[] = ['router', 'manual'];
const PREVIOUS_KEYS = ['ArrowLeft', 'ArrowUp'];
const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];

interface ModeCardProps {
  mode: RouterMode;
  checked: boolean;
  tabbable: boolean;
  disabled: boolean;
  compact: boolean;
  onSelect: (mode: RouterMode) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, mode: RouterMode) => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
}

const ModeCard: React.FC<ModeCardProps> = ({
  mode,
  checked,
  tabbable,
  disabled,
  compact,
  onSelect,
  onKeyDown,
  buttonRef,
}) => {
  const copy = useLocale().t.skillrouter.chooser;
  const card = copy[mode];
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={tabbable ? 0 : -1}
      disabled={disabled}
      onClick={() => onSelect(mode)}
      onKeyDown={(event) => onKeyDown(event, mode)}
      className={`sr-card w-full text-left transition-colors motion-reduce:transition-none ${
        checked ? 'sr-card--selected' : ''
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <span className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 flex h-4 w-4 flex-none items-center justify-center rounded-full border"
          style={{ borderColor: checked ? 'var(--sr-accent)' : 'var(--sr-border)' }}
        >
          {checked && (
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--sr-accent)' }} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="sr-heading">{card.title}</span>
            {mode === 'router' && (
              <span className="sr-pill sr-pill--ok">{copy.recommended}</span>
            )}
          </span>
          <span className="sr-muted sr-text-sm mt-1 block">{card.desc}</span>
          {!compact && (
            <span className="mt-3 block space-y-1">
              {card.points.map((point) => (
                <span key={point} className="sr-text-xs sr-muted flex items-center gap-1.5">
                  <span aria-hidden="true" style={{ color: 'var(--sr-accent)' }}>✓</span>
                  {point}
                </span>
              ))}
            </span>
          )}
        </span>
      </span>
    </button>
  );
};

/**
 * "Where do the AI capabilities come from?" — a two-card radio group. Arrow
 * keys move focus AND selection (native radio behaviour), Tab leaves the group.
 */
const SourceModeChooser: React.FC<SourceModeChooserProps> = ({
  value,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const copy = useLocale().t.skillrouter.chooser;
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  // Nothing chosen yet: the first card is the group's single tab stop.
  const tabStop: RouterMode = value ?? MODES[0];

  const select = (mode: RouterMode) => {
    if (!disabled) onChange(mode);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, mode: RouterMode) => {
    const index = MODES.indexOf(mode);
    let target: RouterMode | null = null;
    if (PREVIOUS_KEYS.includes(event.key)) target = MODES[(index + MODES.length - 1) % MODES.length];
    else if (NEXT_KEYS.includes(event.key)) target = MODES[(index + 1) % MODES.length];
    else if (event.key === 'Home') target = MODES[0];
    else if (event.key === 'End') target = MODES[MODES.length - 1];
    if (!target) return;
    event.preventDefault();
    refs.current[target]?.focus();
    select(target);
  };

  return (
    <div className="sr-scope">
      <div role="radiogroup" aria-label={copy.label} className="grid gap-3 sm:grid-cols-2">
        {MODES.map((mode) => (
          <ModeCard
            key={mode}
            mode={mode}
            checked={value === mode}
            tabbable={tabStop === mode}
            disabled={disabled}
            compact={compact}
            onSelect={select}
            onKeyDown={onKeyDown}
            buttonRef={(node) => {
              refs.current[mode] = node;
            }}
          />
        ))}
      </div>
      <p className="sr-muted sr-text-xs mt-2">{copy.hint}</p>
    </div>
  );
};

export default SourceModeChooser;
