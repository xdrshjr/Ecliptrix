'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SearchKeyField from './SearchKeyField';
import Spinner from './Spinner';
import StepHeading from './StepHeading';
import type { SetupWizardState } from './useSetupWizard';
import { BUTTON_GHOST, BUTTON_PRIMARY } from './wizardStyles';

interface SearchStepProps {
  wizard: SetupWizardState;
}

// Over the 50-line function guideline on purpose: one wizard step is one <form>;
// splitting it would only move JSX between files without isolating any logic.
const SearchStep: React.FC<SearchStepProps> = ({ wizard }) => {
  const copy = useLocale().t.setupWizard;
  const { search } = wizard;
  const unreachable = search.feedback?.kind === 'unreachable';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!search.busy) void search.saveAndTest();
  };

  return (
    <form onSubmit={handleSubmit} aria-busy={search.busy}>
      <StepHeading title={copy.searchTitle} description={copy.searchDesc} />

      <div className="mt-5">
        <SearchKeyField search={search} autoFocus />
      </div>

      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={wizard.goBack} disabled={search.busy} className={BUTTON_GHOST}>
          {copy.back}
        </button>
        <div className="flex items-center gap-2">
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
      </div>
    </form>
  );
};

export default SearchStep;
