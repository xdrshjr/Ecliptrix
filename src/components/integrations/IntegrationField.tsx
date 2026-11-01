'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { IntegrationFieldStatus } from '@/lib/api/integrations';
import SecretInput from '@/components/Onboarding/wizard/SecretInput';
import { FIELD_INPUT } from '@/components/Onboarding/wizard/wizardStyles';
import { DEFAULT_MAX_LIST_ITEMS } from './integrationDrafts';
import { FIELD_LABEL_KEY, isKnownFieldName } from './integrationFieldLabels';

interface IntegrationFieldProps {
  integrationId: string;
  field: IntegrationFieldStatus;
  /** What the user has typed (secret_list: the raw textarea text). */
  draft: string | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

type FieldLabels = ReturnType<typeof useLocale>['t']['integrations']['field'];

const LABEL_CLASS = 'block text-sm font-medium text-foreground';
const HINT_CLASS = 'mt-0.5 text-xs text-muted-foreground';

function fieldLabel(labels: FieldLabels, name: string): string {
  return isKnownFieldName(name) ? labels[FIELD_LABEL_KEY[name]] : name;
}

/**
 * One credential input, rendered from the server-provided field schema.
 * Secrets never show a stored value (the API does not return one); text and
 * choice fields echo what is saved so it can be checked against the console.
 */
const IntegrationField: React.FC<IntegrationFieldProps> = ({
  integrationId,
  field,
  draft,
  onChange,
  disabled,
  autoFocus,
  invalid,
  describedBy,
}) => {
  const copy = useLocale().t.integrations;
  const id = `integration-${integrationId}-${field.name}`;
  const label = fieldLabel(copy.field, field.name);

  if (field.kind === 'secret') {
    return (
      <SecretInput
        id={id}
        label={label}
        hint={field.configured ? copy.hint.keepSecret : undefined}
        value={draft ?? ''}
        onChange={onChange}
        disabled={disabled}
        autoFocus={autoFocus}
        invalid={invalid}
        describedBy={describedBy}
      />
    );
  }

  if (field.kind === 'choice') {
    const current = draft ?? field.value ?? field.choices?.[0] ?? '';
    return (
      <div>
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
        <select
          id={id}
          value={current}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={`mt-1.5 ${FIELD_INPUT}`}
        >
          {(field.choices ?? []).map((choice) => (
            <option key={choice} value={choice}>
              {copy.choice[choice] ?? choice}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.kind === 'secret_list') {
    const max = field.maxItems ?? DEFAULT_MAX_LIST_ITEMS;
    return (
      <div>
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
        </label>
        <p className={HINT_CLASS}>
          {field.configured && field.count
            ? `${copy.hint.configuredCount.replace('{count}', String(field.count))} · `
            : ''}
          {copy.hint.listHint.replace('{max}', String(max))}
        </p>
        <textarea
          id={id}
          rows={3}
          value={draft ?? ''}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`mt-1.5 font-mono aria-[invalid=true]:border-destructive ${FIELD_INPUT}`}
        />
        {field.configured && <p className={HINT_CLASS}>{copy.hint.replaceList}</p>}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        value={draft ?? field.value ?? ''}
        onChange={(event) => onChange(event.target.value.trim())}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 font-mono aria-[invalid=true]:border-destructive ${FIELD_INPUT}`}
      />
    </div>
  );
};

export default IntegrationField;
