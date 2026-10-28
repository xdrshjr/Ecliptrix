'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { isPlaceholderKey } from './modelHints';

interface SecretInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Id of an element describing / reporting an error for this field. */
  describedBy?: string;
  invalid?: boolean;
  /** Shown under the label, e.g. "saved — leave blank to keep". */
  hint?: string;
}

/**
 * Password-style field for API keys: show/hide toggle, paste is trimmed
 * (a stray newline from a copied key is the most common "invalid key" cause),
 * template placeholders are flagged inline. The value is never persisted here.
 */
const SecretInput: React.FC<SecretInputProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  describedBy,
  invalid,
  hint,
}) => {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  const placeholderTyped = isPlaceholderKey(value);

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (pasted === pasted.trim()) return;
    event.preventDefault();
    onChange(pasted.trim());
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="relative mt-1.5">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || placeholderTyped || undefined}
          aria-describedby={describedBy}
          className="w-full rounded-lg border border-input bg-background py-2 pl-3 pr-16 font-mono text-sm text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 aria-[invalid=true]:border-destructive"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-pressed={visible}
          disabled={disabled}
          className="absolute inset-y-1 right-1 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          {visible ? t.setupWizard.hideKey : t.setupWizard.showKey}
        </button>
      </div>
      {placeholderTyped && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {t.setupWizard.err.keyPlaceholder}
        </p>
      )}
    </div>
  );
};

export default SecretInput;
