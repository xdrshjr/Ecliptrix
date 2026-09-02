import React, { useEffect, useId, useState } from 'react';

const clamp = (n: number, min?: number, max?: number) => {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
};

export const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}> = ({ label, value, onChange, min, max, step = 1 }) => {
  const inputId = useId();
  const hintId = useId();
  const [raw, setRaw] = useState(String(value));
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  const commit = (s: string) => {
    const n = Number(s);
    if (!Number.isFinite(n)) {
      setRaw(String(value));
      return;
    }
    const clamped = clamp(n, min, max);
    if (clamped !== n) {
      setHint(`Auto-adjusted to ${clamped}`);
      window.setTimeout(() => setHint(null), 3000);
    }
    setRaw(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const numeric = Number(raw);
  const invalid =
    !Number.isFinite(numeric) ||
    (min !== undefined && numeric < min) ||
    (max !== undefined && numeric > max);

  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={inputId} className="text-sm text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        {hint && (
          <span id={hintId} className="text-xs text-amber-500">{hint}</span>
        )}
        <input
          id={inputId}
          type="number"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value);
            }
          }}
          min={min}
          max={max}
          step={step}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          className="w-28 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>
  );
};

export const SwitchField: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}> = ({ label, checked, onChange }) => {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between">
      <label id={labelId} className="text-sm text-foreground">{label}</label>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </div>
  );
};

export const SelectField: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => {
  const selectId = useId();
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={selectId} className="text-sm text-foreground">{label}</label>
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
};

export const TextField: React.FC<{
  label: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}> = ({ label, value, onChange, readOnly }) => {
  const inputId = useId();
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={inputId} className="text-sm text-foreground">{label}</label>
      <input
        id={inputId}
        type="text"
        value={value}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="w-48 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
      />
    </div>
  );
};

export const LOG_LEVELS = [
  { value: 'DEBUG', label: 'DEBUG' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARNING', label: 'WARNING' },
  { value: 'ERROR', label: 'ERROR' },
];
