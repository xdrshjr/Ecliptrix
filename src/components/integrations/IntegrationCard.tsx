'use client';

import React, { useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type {
  IntegrationSaveError,
  IntegrationStatus,
  ProbeOutcome,
} from '@/lib/api/integrations';
import Spinner from '@/components/Onboarding/wizard/Spinner';
import {
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  ERROR_TEXT,
} from '@/components/Onboarding/wizard/wizardStyles';
import GetCredentialLink from './GetCredentialLink';
import IntegrationField from './IntegrationField';
import { DEFAULT_MAX_LIST_ITEMS } from './integrationDrafts';
import { useIntegrationCard } from './useIntegrationCard';

interface IntegrationCardProps {
  integration: IntegrationStatus;
  onChanged: () => Promise<void> | void;
  onDraftChange?: (hasDraft: boolean) => void;
  /** Wizard only: accept an unverified-but-saved result and move on. */
  onContinueAnyway?: () => void;
  /** Settings only: offer "clear and fall back to .env". */
  allowClear?: boolean;
  /** Settings only: show the name, purpose and source badge above the form. */
  showHeader?: boolean;
  autoFocus?: boolean;
}

type IntegrationCopy = ReturnType<typeof useLocale>['t']['integrations'];

function errorText(copy: IntegrationCopy, error: IntegrationSaveError): string {
  switch (error.kind) {
    case 'placeholder':
      return copy.err.placeholder;
    case 'malformed':
      return copy.err.malformed;
    case 'tooMany':
      return copy.err.tooMany.replace('{max}', String(DEFAULT_MAX_LIST_ITEMS));
    case 'invalidChoice':
      return copy.err.invalidChoice;
    case 'unknownField':
      return copy.err.unknownField;
    case 'originForbidden':
      return copy.err.originForbidden;
    case 'required':
      return copy.err.required;
    default:
      return copy.err.saveFailed;
  }
}

function outcomeText(
  copy: IntegrationCopy,
  integrationId: string,
  outcome: ProbeOutcome,
): string {
  if (outcome === 'ok' && integrationId === 'ark') return copy.test.okArk;
  return copy.test[outcome];
}

function submitLabel(copy: IntegrationCopy, integration: IntegrationStatus, phase: string): string {
  if (phase === 'saving') return copy.action.saving;
  if (phase === 'testing') return copy.action.testing;
  return integration.verifyLevel === 'none' ? copy.action.save : copy.action.saveTest;
}

// Over the 50-line function guideline on purpose: one credential form is one
// <form>; splitting it would only move JSX between files without isolating logic.
const IntegrationCard: React.FC<IntegrationCardProps> = ({
  integration,
  onChanged,
  onDraftChange,
  onContinueAnyway,
  allowClear = false,
  showHeader = false,
  autoFocus = false,
}) => {
  const { t } = useLocale();
  const copy = t.integrations;
  const card = useIntegrationCard({ integration, onChanged, onDraftChange });
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = `integration-${integration.id}-error`;
  const outcomeId = `integration-${integration.id}-outcome`;
  const info = copy[integration.id];
  const hasStored = integration.fields.some((field) => field.source === 'database');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!card.busy) void card.saveAndTest();
  };

  const reenter = () => {
    card.dismissOutcome();
    formRef.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-busy={card.busy} className="space-y-4">
      {showHeader && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-foreground">{info.name}</h3>
            <p className="text-xs text-muted-foreground">{info.desc}</p>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {copy.source[integration.source]}
          </span>
        </div>
      )}

      <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {info.pitfall}
      </p>

      <GetCredentialLink id={integration.id} />

      <div className="space-y-4">
        {integration.fields.map((field, index) => (
          <IntegrationField
            key={field.name}
            integrationId={integration.id}
            field={field}
            draft={card.drafts[field.name]}
            onChange={(value) => card.edit(field.name, value)}
            disabled={card.busy}
            autoFocus={autoFocus && index === 0}
            invalid={card.error?.field === field.name}
            describedBy={card.error ? errorId : undefined}
          />
        ))}
      </div>

      {integration.verifyLevel === 'billed_minimal' && (
        <p className="text-xs text-muted-foreground">{copy.hint.billedTest}</p>
      )}
      {integration.source === 'environment' && (
        <p className="text-xs text-muted-foreground">{copy.hint.fromEnv}</p>
      )}

      {card.error && (
        <p id={errorId} role="alert" className={ERROR_TEXT}>
          {errorText(copy, card.error)}
        </p>
      )}
      {card.outcome && (
        <p
          id={outcomeId}
          role={card.isFailure ? 'alert' : 'status'}
          className={
            card.isFailure
              ? 'text-sm text-amber-700 dark:text-amber-400'
              : 'text-sm text-green-700 dark:text-green-400'
          }
        >
          {outcomeText(copy, integration.id, card.outcome)}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {allowClear && hasStored && (
            <button
              type="button"
              onClick={() => void card.clear()}
              disabled={card.busy}
              className={BUTTON_GHOST}
            >
              {copy.action.clear}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {card.isFailure && (
            <>
              <button type="button" onClick={reenter} className={BUTTON_GHOST}>
                {copy.action.retype}
              </button>
              {onContinueAnyway && (
                <button type="button" onClick={onContinueAnyway} className={BUTTON_GHOST}>
                  {copy.action.saveAnyway}
                </button>
              )}
            </>
          )}
          <button type="submit" disabled={card.busy} className={BUTTON_PRIMARY}>
            {card.busy && <Spinner />}
            {submitLabel(copy, integration, card.phase)}
          </button>
        </div>
      </div>
    </form>
  );
};

export default IntegrationCard;
