'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SourceModeChooser from '@/components/skillrouter/SourceModeChooser';
import { updateSkillRouter } from '@/lib/api/skillrouter';
import Spinner from './Spinner';
import StepHeading from './StepHeading';
import type { SetupWizardState } from './useSetupWizard';
import { BUTTON_GHOST, BUTTON_PRIMARY, ERROR_TEXT } from './wizardStyles';

interface SourceStepProps {
  wizard: SetupWizardState;
}

/** Persist the explicit manual mode; a failure is shown, never thrown. */
async function saveManualChoice(): Promise<boolean> {
  try {
    await updateSkillRouter({ mode: 'manual' });
    return true;
  } catch {
    return false;
  }
}

/**
 * "Where should your AI come from?" Choosing the relay writes nothing yet (the
 * mode flips to `router` when its key is saved on the next step, because the
 * backend refuses `router` without a key). Choosing manual writes the explicit
 * `manual` mode so the question is not asked again; it deletes nothing.
 */
const SourceStep: React.FC<SourceStepProps> = ({ wizard }) => {
  const copy = useLocale().t.setupWizard;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleContinue = async () => {
    if (wizard.choice === 'manual' && wizard.sourceMode !== 'manual') {
      setBusy(true);
      setFailed(false);
      const isSaved = await saveManualChoice();
      setBusy(false);
      setFailed(!isSaved);
      if (!isSaved) return;
    }
    wizard.goNext();
  };

  return (
    <div>
      <StepHeading focusOnMount title={copy.sourceStep.title} description={copy.sourceStep.desc} />

      <div className="mt-5">
        <SourceModeChooser value={wizard.choice} onChange={wizard.selectChoice} disabled={busy} />
      </div>

      <p role="alert" className={failed ? ERROR_TEXT : 'sr-only'}>
        {failed ? copy.sourceStep.saveFailed : ''}
      </p>

      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={wizard.goBack} disabled={busy} className={BUTTON_GHOST}>
          {copy.back}
        </button>
        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={busy}
          aria-busy={busy}
          className={BUTTON_PRIMARY}
        >
          {busy && <Spinner />}
          {busy ? copy.saving : copy.next}
        </button>
      </div>
    </div>
  );
};

export default SourceStep;
