'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import Spinner from './Spinner';
import StepHeading from './StepHeading';
import type { SearchFeedback } from './useSearchStep';
import type { SetupWizardState } from './useSetupWizard';
import {
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  ERROR_TEXT,
  FIELD_INPUT,
  TEXT_LINK,
} from './wizardStyles';
import { MAX_SEARCH_KEYS } from './modelHints';

const TAVILY_KEYS_URL = 'https://app.tavily.com/home';

interface SearchStepProps {
  wizard: SetupWizardState;
}

function useFeedbackText(feedback: SearchFeedback | null): string | null {
  const { t } = useLocale();
  if (!feedback) return null;
  switch (feedback.kind) {
    case 'placeholder':
      return t.setupWizard.err.keyPlaceholder;
    case 'tooMany':
      return t.setupWizard.err.tooManyKeys.replace('{max}', String(MAX_SEARCH_KEYS));
    case 'saveFailed':
      return t.setupWizard.err.generic;
    case 'unreachable':
      return `${t.setupWizard.err.searchUnreachable} ${String(t.webResearch[feedback.copyKey])}`;
  }
}

// Over the 50-line function guideline on purpose: one wizard step is one <form>;
// splitting it would only move JSX between files without isolating any logic.
const SearchStep: React.FC<SearchStepProps> = ({ wizard }) => {
  const copy = useLocale().t.setupWizard;
  const { search } = wizard;
  const feedbackText = useFeedbackText(search.feedback);
  const unreachable = search.feedback?.kind === 'unreachable';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!search.busy) void search.saveAndTest();
  };

  return (
    <form onSubmit={handleSubmit} aria-busy={search.busy}>
      <StepHeading title={copy.searchTitle} description={copy.searchDesc} />

      <div className="mt-5">
        <label htmlFor="setup-search-keys" className="block text-sm font-medium text-foreground">
          {copy.searchKeys}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {copy.searchKeysHint.replace('{max}', String(MAX_SEARCH_KEYS))}
        </p>
        <textarea
          id="setup-search-keys"
          rows={3}
          value={search.draft}
          onChange={(event) => search.edit(event.target.value)}
          disabled={search.busy}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder="tvly-…"
          aria-describedby={feedbackText ? 'setup-search-feedback' : undefined}
          className={`mt-1.5 font-mono ${FIELD_INPUT}`}
        />
        <a
          href={TAVILY_KEYS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-2 inline-block ${TEXT_LINK}`}
        >
          {copy.getKey}
        </a>
      </div>

      {feedbackText && (
        <p
          id="setup-search-feedback"
          role={unreachable ? 'status' : 'alert'}
          className={unreachable ? 'mt-2 text-sm text-amber-700 dark:text-amber-400' : ERROR_TEXT}
        >
          {feedbackText}
        </p>
      )}

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
