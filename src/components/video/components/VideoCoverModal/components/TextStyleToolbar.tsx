'use client';

import React from 'react';

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

/**
 * Compact toolbar that drives the active text layer. Renders disabled when
 * no layer is in edit mode. All style edits propagate immediately via
 * ``onChange`` (spec §2.2.B step 3).
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
  };

  const align = layer?.align ?? 'center';

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
          value={layer?.fontSize ?? 72}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(v)) onChange({ fontSize: Math.min(400, Math.max(8, v)) });
          }}
        />
      </label>

      <label className="block">
        <span className="block mb-1 text-muted-foreground">{labels.color}</span>
        <input
          type="color"
          className="w-full h-7 rounded-sm bg-background border border-border disabled:opacity-50"
          disabled={disabled}
          value={layer?.color ?? '#ffffff'}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </label>

      <div>
        <span className="block mb-1 text-muted-foreground">{labels.align}</span>
        <div className="flex gap-1">
          {ALIGNMENTS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={disabled}
              aria-pressed={align === a}
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
