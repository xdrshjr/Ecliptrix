'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { isGap, type CapabilityStatus } from '@/lib/api/setupStatus';
import IntegrationGroupStep from './IntegrationGroupStep';
import SearchKeyField from './SearchKeyField';
import Spinner from './Spinner';
import StatusPill, { type Tone } from './StatusPill';
import StepHeading from './StepHeading';
import type { SetupWizardState } from './useSetupWizard';
import { MANUAL_ONLY_CAPABILITIES } from '@/lib/api/skillrouter';
import { BUTTON_GHOST, BUTTON_PRIMARY } from './wizardStyles';

interface ManualOnlyStepProps {
  wizard: SetupWizardState;
  capabilities: CapabilityStatus[];
}

type SearchRowState = 'ready' | 'missing' | 'invalid' | 'optedOut';

function searchRowState(
  capability: CapabilityStatus | undefined,
  isOptedOut: boolean,
): SearchRowState {
  if (capability?.state === 'ready') return 'ready';
  if (isOptedOut) return 'optedOut';
  return capability?.state === 'invalid' ? 'invalid' : 'missing';
}

const SEARCH_TONE: Record<SearchRowState, Tone> = {
  ready: 'good',
  missing: 'warn',
  invalid: 'bad',
  optedOut: 'neutral',
};

/** Web search: the Tavily key box with its own save-and-test button. */
const SearchSection: React.FC<{
  wizard: SetupWizardState;
  state: SearchRowState;
}> = ({ wizard, state }) => {
  const copy = useLocale().t.setupWizard;
  const { search } = wizard;
  const unreachable = search.feedback?.kind === 'unreachable';
  const headingId = 'setup-manual-only-search';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!search.busy) void search.saveAndTest();
  };

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-medium text-foreground">
            {copy.cap.web_search.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{copy.cap.web_search.desc}</p>
        </div>
        <StatusPill tone={SEARCH_TONE[state]} label={copy.state[state]} />
      </div>
      {state !== 'ready' && (
        <form onSubmit={handleSubmit} aria-busy={search.busy} className="mt-3">
          <SearchKeyField search={search} />
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={search.skip} disabled={search.busy} className={BUTTON_GHOST}>
              {copy.skipSearch}
            </button>
            {unreachable ? (
              <button type="button" onClick={search.continueAnyway} className={BUTTON_PRIMARY}>
                {copy.saveAnyway}
              </button>
            ) : (
              <button
                type="submit"
                disabled={search.busy || search.keys.length === 0}
                className={BUTTON_PRIMARY}
              >
                {search.busy && <Spinner />}
                {search.busy ? copy.testing : copy.saveTest}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
};

const ManualOnlyFooter: React.FC<{
  wizard: SetupWizardState;
  unresolved: CapabilityStatus[];
}> = ({ wizard, unresolved }) => {
  const { t } = useLocale();
  const copy = t.setupWizard;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
      <button type="button" onClick={wizard.goBack} className={BUTTON_GHOST}>
        {copy.back}
      </button>
      <div className="flex flex-wrap items-center gap-2">
        {unresolved.length > 0 && (
          <button
            type="button"
            onClick={() => {
              wizard.optOut(unresolved.map((item) => item.id));
              wizard.goNext();
            }}
            className={BUTTON_GHOST}
          >
            {copy.manualOnlyStep.skipAll}
          </button>
        )}
        <button type="button" onClick={wizard.goNext} className={BUTTON_PRIMARY}>
          {unresolved.length > 0
            ? t.integrations.action.continueLater
            : t.integrations.action.continueNext}
        </button>
      </div>
    </div>
  );
};

/**
 * The three capabilities the relay never serves (web search, subtitle
 * recognition, voice cloning), configured with the same cards as the manual
 * flow. Everything here is optional: "skip" reuses the regular opt-out.
 */
const ManualOnlyStep: React.FC<ManualOnlyStepProps> = ({ wizard, capabilities }) => {
  const { t } = useLocale();
  const copy = t.setupWizard;
  const manualOnly = capabilities.filter((item) =>
    (MANUAL_ONLY_CAPABILITIES as readonly string[]).includes(item.id),
  );
  const unresolved = manualOnly.filter(
    (item) => isGap(item) && !wizard.optOuts.includes(item.id),
  );
  const searchCapability = manualOnly.find((item) => item.id === 'web_search');
  const searchState = searchRowState(searchCapability, wizard.optOuts.includes('web_search'));

  return (
    <div>
      <StepHeading focusOnMount title={copy.manualOnlyStep.title} description={copy.manualOnlyStep.desc} />

      <div className="mt-5 space-y-3">
        <SearchSection wizard={wizard} state={searchState} />
        <IntegrationGroupStep
          wizard={wizard}
          group="voice"
          ids={['volcano_asr', 'volcano_voice_clone']}
          bare
        />
      </div>

      <ManualOnlyFooter wizard={wizard} unresolved={unresolved} />
    </div>
  );
};

export default ManualOnlyStep;
