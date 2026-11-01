'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  classifyIntegrationError,
  clearIntegration,
  notConfiguredIntegration,
  saveIntegration,
  testIntegration,
  type IntegrationSaveError,
  type IntegrationStatus,
  type ProbeOutcome,
} from '@/lib/api/integrations';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';
import { removeOptOut } from '@/lib/setupOptOut';
import {
  buildPatch,
  hasUnsubmittedInput,
  type FieldDrafts,
} from './integrationDrafts';

type Phase = 'idle' | 'saving' | 'testing' | 'clearing';

interface IntegrationCardArgs {
  integration: IntegrationStatus;
  /** Re-read the integration list after a write so badges and pills follow. */
  onChanged: () => Promise<void> | void;
  /** Reports whether unsubmitted secret input exists (drives the Esc guard). */
  onDraftChange?: (hasDraft: boolean) => void;
}

/** Outcomes that mean "saved and nothing the user must fix". */
const SETTLED_OUTCOMES: readonly ProbeOutcome[] = ['ok', 'unverifiable'];

/**
 * State machine of one credential card: edit → save (PUT) → test (POST).
 * Drafts live in memory only and are dropped the moment a save succeeds; the
 * saved value is never read back (the API does not return it).
 *
 * Over the 50-line function guideline on purpose: the four callbacks share the
 * same draft/phase/outcome state and read as one state machine.
 */
export function useIntegrationCard({
  integration,
  onChanged,
  onDraftChange,
}: IntegrationCardArgs) {
  const [drafts, setDrafts] = useState<FieldDrafts>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [outcome, setOutcome] = useState<ProbeOutcome | null>(null);
  const [error, setError] = useState<IntegrationSaveError | null>(null);

  const hasDraft = useMemo(
    () => hasUnsubmittedInput(integration, drafts),
    [integration, drafts],
  );
  useEffect(() => onDraftChange?.(hasDraft), [hasDraft, onDraftChange]);

  const edit = useCallback((name: string, value: string) => {
    setDrafts((current) => ({ ...current, [name]: value }));
    setError(null);
    setOutcome(null);
  }, []);

  /**
   * A write succeeded: forget the plaintext and refresh. Saving credentials
   * un-mutes the reminders for what they unlock; clearing them does not.
   */
  const afterWrite = useCallback(
    async (unmute: boolean) => {
      setDrafts({});
      if (unmute) integration.capabilities.forEach((id) => removeOptOut(id));
      notifySetupConfigUpdated();
      await onChanged();
    },
    [integration.capabilities, onChanged],
  );

  const runTest = useCallback(async () => {
    if (integration.verifyLevel === 'none') return setOutcome('unverifiable');
    setPhase('testing');
    try {
      const result = await testIntegration(integration.id);
      setOutcome(result.outcome);
    } catch (failure) {
      // 409 credential_not_configured: the backend sees nothing usable saved.
      if (notConfiguredIntegration(failure)) return setError({ kind: 'required' });
      const classified = classifyIntegrationError(failure);
      if (classified.kind === 'originForbidden') setError(classified);
      else setOutcome('upstream_error');
    }
  }, [integration.id, integration.verifyLevel]);

  const saveAndTest = useCallback(async () => {
    const built = buildPatch(integration, drafts);
    if (built.error) return setError(built.error);
    setError(null);
    setOutcome(null);
    setPhase('saving');
    try {
      if (Object.keys(built.patch).length > 0) {
        await saveIntegration(integration.id, built.patch);
        await afterWrite(true);
      }
      await runTest();
    } catch (failure) {
      setError(classifyIntegrationError(failure));
    } finally {
      setPhase('idle');
    }
  }, [afterWrite, drafts, integration, runTest]);

  const clear = useCallback(async () => {
    setPhase('clearing');
    setError(null);
    setOutcome(null);
    try {
      await clearIntegration(integration.id);
      await afterWrite(false);
    } catch (failure) {
      setError(classifyIntegrationError(failure));
    } finally {
      setPhase('idle');
    }
  }, [afterWrite, integration.id]);

  /** "Re-enter": drop the failure banner so the form reads as fresh again. */
  const dismissOutcome = useCallback(() => setOutcome(null), []);

  return {
    drafts,
    phase,
    busy: phase !== 'idle',
    outcome,
    error,
    hasDraft,
    isSettled: outcome !== null && SETTLED_OUTCOMES.includes(outcome),
    isFailure: outcome !== null && !SETTLED_OUTCOMES.includes(outcome),
    edit,
    saveAndTest,
    clear,
    dismissOutcome,
  };
}

export type IntegrationCardState = ReturnType<typeof useIntegrationCard>;
