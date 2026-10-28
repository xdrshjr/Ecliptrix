'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { KnownProvider } from '@/lib/api/modelSettings';
import SecretInput from './SecretInput';
import Spinner from './Spinner';
import StepHeading from './StepHeading';
import { CUSTOM_PROVIDER_ID, type ProviderError } from './useProviderStep';
import type { SetupWizardState } from './useSetupWizard';
import {
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  ERROR_TEXT,
  FIELD_INPUT,
  TEXT_LINK,
} from './wizardStyles';

interface ProviderStepProps {
  wizard: SetupWizardState;
}

const CARD_BASE =
  'rounded-lg border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none';

function cardClass(selected: boolean): string {
  return `${CARD_BASE} ${
    selected
      ? 'border-primary bg-primary/5 text-foreground'
      : 'border-border text-foreground hover:bg-accent/60'
  }`;
}

interface PresetGroupProps {
  title: string;
  providers: KnownProvider[];
  selectedId: string;
  onPick: (id: string) => void;
}

const PresetGroup: React.FC<PresetGroupProps> = ({ title, providers, selectedId, onPick }) => {
  if (providers.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            aria-pressed={selectedId === provider.id}
            onClick={() => onPick(provider.id)}
            className={cardClass(selectedId === provider.id)}
          >
            {provider.name}
          </button>
        ))}
      </div>
    </div>
  );
};

function useErrorText(error: ProviderError | null): string | null {
  const copy = useLocale().t.setupWizard.err;
  if (!error) return null;
  if (error.code === 'generic') return `${copy.generic} ${error.detail}`;
  return copy[error.code];
}

// Over the 50-line function guideline on purpose: one wizard step is one <form>;
// splitting it would only move JSX between files without isolating any logic.
const ProviderStep: React.FC<ProviderStepProps> = ({ wizard }) => {
  const copy = useLocale().t.setupWizard;
  const { provider } = wizard;
  const { draft, known, saved, reusingSaved, verifying } = provider;
  const errorText = useErrorText(provider.error);
  const isCustom = draft.knownId === CUSTOM_PROVIDER_ID || !known.some((p) => p.id === draft.knownId);
  const showForm = !reusingSaved && draft.knownId !== '';
  const domestic = known.filter((item) => item.region === 'domestic');
  const international = known.filter((item) => item.region !== 'domestic');

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!verifying) void provider.verify();
  };

  return (
    <form onSubmit={handleSubmit} aria-busy={verifying}>
      <StepHeading title={copy.providerTitle} description={copy.providerDesc} />

      <div className="mt-5 space-y-4">
        {saved.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {copy.savedProviders}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {saved.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={reusingSaved?.id === item.id}
                  onClick={() => provider.pickSaved(item)}
                  className={cardClass(reusingSaved?.id === item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <PresetGroup
          title={copy.regionDomestic}
          providers={domestic}
          selectedId={reusingSaved ? '' : draft.knownId}
          onPick={provider.pickKnown}
        />
        <PresetGroup
          title={copy.regionInternational}
          providers={international}
          selectedId={reusingSaved ? '' : draft.knownId}
          onPick={provider.pickKnown}
        />
        <button
          type="button"
          aria-pressed={!reusingSaved && draft.knownId === CUSTOM_PROVIDER_ID}
          onClick={() => provider.pickKnown(CUSTOM_PROVIDER_ID)}
          className={cardClass(!reusingSaved && draft.knownId === CUSTOM_PROVIDER_ID)}
        >
          {copy.customProvider}
        </button>
      </div>

      {reusingSaved && (
        <p role="status" className="mt-5 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {copy.usingSaved.replace('{name}', reusingSaved.name)}
        </p>
      )}

      {showForm && (
        <div className="mt-5 space-y-4">
          <SecretInput
            id="setup-api-key"
            label={copy.apiKey}
            hint={provider.hasStoredKey ? copy.keyKept : undefined}
            placeholder={copy.apiKeyPlaceholder}
            value={draft.apiKey}
            onChange={(apiKey) => provider.editDraft({ apiKey })}
            disabled={verifying}
            invalid={provider.error?.code === 'keyInvalid'}
            describedBy={errorText ? 'setup-provider-error' : undefined}
            autoFocus
          />
          {isCustom && (
            <div>
              <label htmlFor="setup-api-url" className="block text-sm font-medium text-foreground">
                {copy.apiUrl}
              </label>
              <input
                id="setup-api-url"
                type="url"
                inputMode="url"
                value={draft.apiUrl}
                onChange={(event) => provider.editDraft({ apiUrl: event.target.value.trim() })}
                placeholder="https://api.example.com/v1"
                disabled={verifying}
                className={`mt-1.5 ${FIELD_INPUT}`}
              />
            </div>
          )}
          <details className="text-sm">
            <summary className={`cursor-pointer text-muted-foreground ${TEXT_LINK}`}>
              {copy.advanced}
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="setup-provider-name" className="block text-xs text-muted-foreground">
                  {copy.providerName}
                </label>
                <input
                  id="setup-provider-name"
                  value={draft.name}
                  onChange={(event) => provider.editDraft({ name: event.target.value })}
                  disabled={verifying}
                  className={`mt-1 ${FIELD_INPUT}`}
                />
              </div>
              {!isCustom && (
                <div>
                  <label htmlFor="setup-api-url-adv" className="block text-xs text-muted-foreground">
                    {copy.apiUrl}
                  </label>
                  <input
                    id="setup-api-url-adv"
                    value={draft.apiUrl}
                    onChange={(event) => provider.editDraft({ apiUrl: event.target.value.trim() })}
                    disabled={verifying}
                    className={`mt-1 ${FIELD_INPUT}`}
                  />
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {errorText && (
        <p id="setup-provider-error" role="alert" className={ERROR_TEXT}>
          {errorText}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={wizard.goBack} disabled={verifying} className={BUTTON_GHOST}>
          {copy.back}
        </button>
        <div className="flex items-center gap-2">
          {provider.canSkipVerify && (
            <button
              type="button"
              onClick={() => void provider.verify(true)}
              disabled={verifying}
              className={BUTTON_GHOST}
            >
              {copy.skipVerify}
            </button>
          )}
          <button
            type="submit"
            disabled={verifying || (!showForm && !reusingSaved)}
            className={BUTTON_PRIMARY}
          >
            {verifying && <Spinner />}
            {verifying ? copy.verifying : copy.verifyContinue}
          </button>
        </div>
      </div>
    </form>
  );
};

export default ProviderStep;
