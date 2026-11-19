'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import RouterModelSlots from '@/components/skillrouter/RouterModelSlots';
import { useSkillRouter } from '@/components/skillrouter/useSkillRouter';
import StepHeading from './StepHeading';
import type { SetupWizardState } from './useSetupWizard';
import { BUTTON_GHOST, BUTTON_PRIMARY, TEXT_LINK } from './wizardStyles';

interface RouterModelsStepProps {
  wizard: SetupWizardState;
}

/**
 * One model per LLM slot, already filled with the relay's recommendation: the
 * user may just continue. The slot list handles the empty and failed catalogue
 * states itself, so this step never blocks on the network.
 */
const RouterModelsStep: React.FC<RouterModelsStepProps> = ({ wizard }) => {
  const copy = useLocale().t.setupWizard;
  const { status, catalog, catalogState, loadState, reload, save, refreshCatalog } =
    useSkillRouter({ withCatalog: true });

  return (
    <div>
      <StepHeading
        focusOnMount
        title={copy.routerModelsStep.title}
        description={copy.routerModelsStep.desc}
      />

      <div className="mt-5">
        {loadState === 'error' && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            {copy.err.generic}
            <button type="button" onClick={() => void reload()} className={TEXT_LINK}>
              {copy.retry}
            </button>
          </div>
        )}
        {status && (
          <RouterModelSlots
            status={status}
            catalog={catalog}
            catalogState={catalogState}
            onSave={save}
            onRefreshCatalog={refreshCatalog}
          />
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={wizard.goBack} className={BUTTON_GHOST}>
          {copy.back}
        </button>
        <button type="button" onClick={wizard.goNext} className={BUTTON_PRIMARY}>
          {copy.next}
        </button>
      </div>
    </div>
  );
};

export default RouterModelsStep;
