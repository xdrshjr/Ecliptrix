'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import CapabilityChecklist from './CapabilityChecklist';
import StepHeading from './StepHeading';
import { BUTTON_GHOST, BUTTON_PRIMARY, TEXT_LINK } from './wizardStyles';
import {
  countOptionalGaps,
  countRemainingGaps,
  type WizardMode,
} from './wizardSteps';

interface OverviewStepProps {
  capabilities: CapabilityStatus[];
  optOuts: readonly CapabilityId[];
  mode: WizardMode;
  onStart: () => void;
  onLater: () => void;
  onOpenModelSettings: () => void;
  /** Mute every optional gap in one go and keep only the model steps. */
  onSkipOptional: () => void;
}

const OverviewStep: React.FC<OverviewStepProps> = ({
  capabilities,
  optOuts,
  mode,
  onStart,
  onLater,
  onOpenModelSettings,
  onSkipOptional,
}) => {
  const { t } = useLocale();
  const copy = t.setupWizard;
  const remaining = countRemainingGaps(capabilities, optOuts);
  const hasOptionalGaps = countOptionalGaps(capabilities, optOuts) > 0;
  const isResuming = mode === 'auto' && remaining < capabilities.length;

  return (
    <div>
      <StepHeading title={copy.title} description={`${copy.subtitle} ${copy.privacyNote}`} />

      <div className="mt-6">
        <CapabilityChecklist capabilities={capabilities} optOuts={optOuts} />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{copy.duration}</p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" onClick={onOpenModelSettings} className={TEXT_LINK}>
            {copy.openSettings}
          </button>
          {hasOptionalGaps && (
            <button type="button" onClick={onSkipOptional} className={TEXT_LINK}>
              {t.integrations.action.skipOptional}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onLater} className={BUTTON_GHOST}>
            {copy.later}
          </button>
          <button type="button" autoFocus onClick={onStart} className={BUTTON_PRIMARY}>
            {isResuming ? copy.resume : copy.start}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OverviewStep;
