'use client';

import React, { useCallback, useEffect } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import RouterConnectCard from '@/components/skillrouter/RouterConnectCard';
import { useSkillRouter } from '@/components/skillrouter/useSkillRouter';
import StepHeading from './StepHeading';
import type { SetupWizardState } from './useSetupWizard';
import { BUTTON_GHOST, BUTTON_PRIMARY, TEXT_LINK } from './wizardStyles';

interface RouterStepProps {
  wizard: SetupWizardState;
}

/**
 * Register link, key, zero-cost verification: all of it inside the shared
 * connection card. The card only offers "save" after a successful check (or,
 * for a network problem, an explicit "save and verify later"), and saving is
 * what writes `mode=router`, so the way forward is gated by construction.
 * A key that is already saved and active may simply be kept.
 */
const RouterStep: React.FC<RouterStepProps> = ({ wizard }) => {
  const copy = useLocale().t.setupWizard;
  const { status, loadState, reload } = useSkillRouter();
  const isConnected = status !== null && status.keyConfigured && status.mode === 'router';
  const { reportIntegrationDraft } = wizard;

  // An unsaved `ar-` key counts as a draft, so closing the wizard asks first
  // (same guard as every integration card). Leaving the step drops the flag.
  const reportDraft = useCallback(
    (hasDraft: boolean) => reportIntegrationDraft('skillrouter', hasDraft),
    [reportIntegrationDraft],
  );
  useEffect(() => () => reportIntegrationDraft('skillrouter', false), [reportIntegrationDraft]);

  return (
    <div>
      <StepHeading focusOnMount title={copy.routerStep.title} description={copy.routerStep.desc} />

      <div className="mt-5">
        {loadState === 'loading' && (
          <div className="sr-scope" aria-busy="true">
            <div className="sr-skeleton h-48 w-full" />
          </div>
        )}
        {loadState === 'error' && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            {copy.err.generic}
            <button type="button" onClick={() => void reload()} className={TEXT_LINK}>
              {copy.retry}
            </button>
          </div>
        )}
        {status && (
          <RouterConnectCard status={status} onSaved={wizard.goNext} onDraftChange={reportDraft} />
        )}
      </div>

      {!isConnected && status && (
        <p className="mt-3 text-xs text-muted-foreground">{copy.routerStep.needsKey}</p>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={wizard.goBack} className={BUTTON_GHOST}>
          {copy.back}
        </button>
        {isConnected && (
          <button type="button" onClick={wizard.goNext} className={BUTTON_PRIMARY}>
            {copy.routerStep.continueConnected}
          </button>
        )}
      </div>
    </div>
  );
};

export default RouterStep;
