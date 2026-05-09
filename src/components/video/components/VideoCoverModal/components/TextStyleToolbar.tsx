'use client';

import React, { useEffect, useRef, useState } from 'react';

import type { CoverTextAlign, CoverTextLayer } from '../types';
import { useLocale } from '@/contexts/LocaleContext';

interface TextStyleToolbarProps {
  layer: CoverTextLayer | null;
  onChange: (patch: Partial<CoverTextLayer>) => void;
}

const FONT_OPTIONS: Array<{ label: string; value: string }> = [
  {
    label: 'System Sans',
    value:
      'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  { label: 'Serif', value: 'Georgia, "Times New Roman", "Songti SC", serif' },
  { label: 'Mono', value: 'ui-monospace, "Courier New", monospace' },
];

const ALIGNMENTS: CoverTextAlign[] = ['left', 'center', 'right'];

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Compact toolbar that drives the active text layer. Renders disabled when
 * no layer is in edit mode. All style edits propagate immediately via
 * ``onChange`` (spec §2.2.B step 3).
 *
 * The size / color text inputs are draft-mode: the underlying layer is only
 * updated on commit (blur / Enter). Invalid values are rejected and surface
 * a helper message; out-of-range sizes clamp + show a 3 s clamp toast.
 */
export const TextStyleToolbar: React.FC<TextStyleToolbarProps> = ({ layer, onChange }) => {
  const { t } = useLocale();
  const disabled = layer === null;
  const labels = t.videoCoverModal?.textTools ?? {
    font: 'Font',
    size: 'Size',
    color: 'Color',
    align: 'Align',
    alignLeft: 'Left',
    alignCenter: 'Center',
    alignRight: 'Right',
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    colorSwatch: 'Color picker',
    colorInvalid: 'Use a hex like #fff or #ffffff',
    sizeClamped: 'Clamped {from} → {to}',
  };

  const align = layer?.align ?? 'center';
  const currentSize = layer?.fontSize ?? 72;
  const currentColor = layer?.color ?? '#ffffff';

  // Draft state — kept in sync with the active layer but allowed to diverge
  // while the user is typing.
  const [sizeDraft, setSizeDraft] = useState<string>(String(currentSize));
  const [clampedFrom, setClampedFrom] = useState<number | null>(null);
  const clampTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [colorDraft, setColorDraft] = useState<string>(currentColor);
  const [colorError, setColorError] = useState<boolean>(false);

  useEffect(() => {
    setSizeDraft(String(currentSize));
  }, [currentSize, layer?.key]);

  useEffect(() => {
    setColorDraft(currentColor);
    setColorError(false);
  }, [currentColor, layer?.key]);

  useEffect(() => () => {
    if (clampTimerRef.current) clearTimeout(clampTimerRef.current);
  }, []);

  const commitSize = () => {
    const v = Number.parseInt(sizeDraft, 10);
    if (!Number.isFinite(v)) {
      // Reject empty / non-numeric: snap back to the canonical model value
      // so the input never visually clears while the model retains the old
      // size.
      setSizeDraft(String(currentSize));
      setClampedFrom(null);
      return;
    }
    const clamped = Math.min(400, Math.max(8, v));
    if (clamped !== v) {
      setClampedFrom(v);
      if (clampTimerRef.current) clearTimeout(clampTimerRef.current);
      clampTimerRef.current = setTimeout(() => setClampedFrom(null), 3000);
      setSizeDraft(String(clamped));
    } else {
      setClampedFrom(null);
    }
    if (clamped !== currentSize) {
      onChange({ fontSize: clamped });
    }
  };

  const commitColor = () => {
    const draft = colorDraft.trim();
    if (!HEX_COLOR_RE.test(draft)) {
      setColorError(true);
      // Snap visual draft back to current color so the swatch and the model
      // never diverge silently.
      setColorDraft(currentColor);
      return;
    }
    setColorError(false);
    if (draft.toLowerCase() !== currentColor.toLowerCase()) {
      onChange({ color: draft });
    }
  };

  const sizeClampedMsg =
    clampedFrom != null
      ? labels.sizeClamped
          .replace('{from}', String(clampedFrom))
          .replace('{to}', String(Math.min(400, Math.max(8, clampedFrom))))
      : null;

  return (
    <div className="text-xs space-y-2 p-2 rounded-md border border-border bg-background/50">
      {disabled && (
        <p className="text-muted-foreground italic">
          {t.videoCoverModal?.textTools?.font
            ? '— —'
            : '—'}
        </p>
      )}

      <label className="block">
        <span className="block mb-1 text-muted-foreground">{labels.font}</span>
        <select
          className="w-full px-2 py-1 rounded-sm bg-background border border-border disabled:opacity-50"
          disabled={disabled}
          aria-label={labels.font}
          value={layer?.fontFamily ?? FONT_OPTIONS[0].value}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
        >
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.label} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block mb-1 text-muted-foreground">{labels.size}</span>
        <input
          type="number"
          min={8}
          max={400}
          step={1}
          className="w-full px-2 py-1 rounded-sm bg-background border border-border disabled:opacity-50"
          disabled={disabled}
          aria-label={labels.size}
          value={sizeDraft}
          onChange={(e) => setSizeDraft(e.target.value)}
          onBlur={commitSize}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitSize();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        {sizeClampedMsg && (
          <span className="block mt-1 text-amber-400" role="status" aria-live="polite">
            {sizeClampedMsg}
          </span>
        )}
      </label>

      <label className="block">
        <span className="block mb-1 text-muted-foreground">{labels.color}</span>
        <div className="flex gap-1">
          <input
            type="color"
            className="h-7 w-9 rounded-sm bg-background border border-border disabled:opacity-50"
            disabled={disabled}
            aria-label={labels.colorSwatch}
            value={HEX_COLOR_RE.test(colorDraft) ? colorDraft : currentColor}
            onChange={(e) => {
              setColorError(false);
              setColorDraft(e.target.value);
              onChange({ color: e.target.value });
            }}
          />
          <input
            type="text"
            className={[
              'flex-1 px-2 py-1 rounded-sm bg-background border disabled:opacity-50',
              colorError ? 'border-destructive' : 'border-border',
            ].join(' ')}
            disabled={disabled}
            aria-label={labels.color}
            aria-invalid={colorError || undefined}
            value={colorDraft}
            spellCheck={false}
            onChange={(e) => setColorDraft(e.target.value)}
            onBlur={commitColor}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitColor();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
        </div>
        {colorError && (
          <span className="block mt-1 text-destructive" role="alert">
            {labels.colorInvalid}
          </span>
        )}
      </label>

      <div>
        <span className="block mb-1 text-muted-foreground">{labels.align}</span>
        <div className="flex gap-1" role="radiogroup" aria-label={labels.align}>
          {ALIGNMENTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              disabled={disabled}
              aria-checked={align === a}
              aria-label={
                a === 'left' ? labels.alignLeft : a === 'center' ? labels.alignCenter : labels.alignRight
              }
              className={[
                'flex-1 px-2 py-1 rounded-sm border text-foreground',
                align === a
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/60',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
              onClick={() => onChange({ align: a })}
            >
              {a === 'left' ? labels.alignLeft : a === 'center' ? labels.alignCenter : labels.alignRight}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1">
        <ToggleButton
          label={labels.bold}
          active={(layer?.fontWeight ?? 700) >= 700}
          disabled={disabled}
          onClick={() => onChange({ fontWeight: (layer?.fontWeight ?? 700) >= 700 ? 400 : 700 })}
        />
        <ToggleButton
          label={labels.italic}
          active={!!layer?.italic}
          disabled={disabled}
          onClick={() => onChange({ italic: !layer?.italic })}
        />
        <ToggleButton
          label={labels.underline}
          active={!!layer?.underline}
          disabled={disabled}
          onClick={() => onChange({ underline: !layer?.underline })}
        />
      </div>
    </div>
  );
};

interface ToggleButtonProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const ToggleButton: React.FC<ToggleButtonProps> = ({ label, active, disabled, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    aria-pressed={active}
    aria-label={label}
    className={[
      'flex-1 px-2 py-1 rounded-sm border',
      active ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary/60',
    ].join(' ')}
    onClick={onClick}
  >
    {label}
  </button>
);

export default TextStyleToolbar;
