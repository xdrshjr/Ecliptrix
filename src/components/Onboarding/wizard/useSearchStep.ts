'use client';

import { useCallback, useMemo, useState } from 'react';
import { resolveResearchStatus } from '@/lib/webResearchStatus';
import {
  saveResearchCredentials,
  testResearchConnection,
} from '@/lib/api/webResearch';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';
import { addOptOut, removeOptOut } from '@/lib/setupOptOut';
import {
  isPlaceholderKey,
  MAX_SEARCH_KEYS,
  parseSearchKeys,
} from './modelHints';
import type { Translations } from '@/lib/i18n';

export type SearchFeedback =
  | { kind: 'placeholder' | 'tooMany' | 'saveFailed' }
  | { kind: 'unreachable'; copyKey: Exclude<keyof Translations['webResearch'], 'tools'> };

/** Tavily key entry, save-and-test, and the "don't use search" opt-out. */
export function useSearchStep(onDone: () => void) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<SearchFeedback | null>(null);

  const keys = useMemo(() => parseSearchKeys(draft), [draft]);

  const edit = useCallback((value: string) => {
    setDraft(value);
    setFeedback(null);
  }, []);

  const finish = useCallback(() => {
    setDraft('');
    notifySetupConfigUpdated();
    onDone();
  }, [onDone]);

  const saveAndTest = useCallback(async () => {
    if (keys.length === 0) return;
    if (keys.some(isPlaceholderKey)) return setFeedback({ kind: 'placeholder' });
    if (keys.length > MAX_SEARCH_KEYS) return setFeedback({ kind: 'tooMany' });
    setBusy(true);
    setFeedback(null);
    try {
      await saveResearchCredentials(keys);
      removeOptOut('web_search');
      const result = await testResearchConnection();
      if (result.reachable) return finish();
      const copy = resolveResearchStatus({ error_code: result.error_code });
      setFeedback({ kind: 'unreachable', copyKey: copy?.key ?? 'searchConnectionFailed' });
      notifySetupConfigUpdated();
    } catch {
      setFeedback({ kind: 'saveFailed' });
    } finally {
      setBusy(false);
    }
  }, [finish, keys]);

  /** The keys are already saved; the user accepts an unreachable test. */
  const continueAnyway = useCallback(() => finish(), [finish]);

  const skip = useCallback(() => {
    addOptOut('web_search');
    finish();
  }, [finish]);

  return {
    draft,
    keys,
    busy,
    feedback,
    hasDraft: draft.trim() !== '',
    edit,
    saveAndTest,
    continueAnyway,
    skip,
  };
}
