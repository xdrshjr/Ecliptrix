'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import CapabilityChecklist from './CapabilityChecklist';
import StepHeading from './StepHeading';
import { BUTTON_PRIMARY, TEXT_LINK } from './wizardStyles';
import { countRemainingGaps } from './wizardSteps';

interface DoneStepProps {
  capabilities: CapabilityStatus[];
  optOuts: readonly CapabilityId[];
  onFinish: () => void;
  onOpenModelSettings: () => void;
}

/**
 * Wording is deliberately "configured", never "verified": only the chat model
 * is connectivity-tested on save (RV-13).
 */
const DoneStep: React.FC<DoneStepProps> = ({
  capabilities,
  optOuts,
  onFinish,
  onOpenModelSettings,
}) => {
  const copy = useLocale().t.setupWizard;
  const remaining = countRemainingGaps(capabilities, optOuts);
  const isComplete = remaining === 0;

  return (
    <div>
      <StepHeading
        title={isComplete ? copy.doneTitle : copy.donePartialTitle}
        description={
          isComplete
            ? copy.doneDesc
            : copy.finishPartialNote.replace('{count}', String(remaining))
        }
      />

      <div className="mt-6">
        <CapabilityChecklist capabilities={capabilities} optOuts={optOuts} showDetails />
      </div>

      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={onOpenModelSettings} className={TEXT_LINK}>
          {copy.openSettings}
        </button>
        <button type="button" autoFocus onClick={onFinish} className={BUTTON_PRIMARY}>
          {isComplete ? copy.finish : copy.finishPartial}
        </button>
      </div>
    </div>
  );
};

export default DoneStep;
