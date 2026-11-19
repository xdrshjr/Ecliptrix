'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import GetCredentialLink from '@/components/integrations/GetCredentialLink';
import { MAX_SEARCH_KEYS } from './modelHints';
import type { SearchFeedback, useSearchStep } from './useSearchStep';
import { ERROR_TEXT, FIELD_INPUT } from './wizardStyles';

type SearchState = ReturnType<typeof useSearchStep>;

interface SearchKeyFieldProps {
  search: SearchState;
  autoFocus?: boolean;
}

/** Wording for a failed save or test of the search keys, or null when fine. */
export function useSearchFeedbackText(feedback: SearchFeedback | null): string | null {
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

/**
 * The Tavily key box shared by the web-search step and the "set up by hand"
 * step of the relay flow: label, textarea, "get a key" link and feedback line.
 */
const SearchKeyField: React.FC<SearchKeyFieldProps> = ({ search, autoFocus = false }) => {
  const copy = useLocale().t.setupWizard;
  const feedbackText = useSearchFeedbackText(search.feedback);
  const unreachable = search.feedback?.kind === 'unreachable';

  return (
    <>
      <div>
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
          autoFocus={autoFocus}
          placeholder="tvly-…"
          aria-describedby={feedbackText ? 'setup-search-feedback' : undefined}
          className={`mt-1.5 font-mono ${FIELD_INPUT}`}
        />
        <GetCredentialLink id="tavily" label={copy.getKey} className="mt-2" />
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
    </>
  );
};

export default SearchKeyField;
