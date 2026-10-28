'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import {
  deriveWizardSteps,
  selectableSlots,
  type WizardMode,
  type WizardStepId,
} from './wizardSteps';
import { useModelsStep } from './useModelsStep';
import { useProviderStep } from './useProviderStep';
import { useSearchStep } from './useSearchStep';

interface SetupWizardArgs {
  capabilities: CapabilityStatus[];
  optOuts: CapabilityId[];
  mode: WizardMode;
}

/**
 * State for the whole wizard: frozen step list, navigation, and one hook per
 * data-bearing step. No UI here — see the step components.
 */
export function useSetupWizard({ capabilities, optOuts, mode }: SetupWizardArgs) {
  // Frozen at open: a status refetch after the first write must not reshuffle
  // the stepper while the user is mid-flow.
  const [steps] = useState<WizardStepId[]>(() =>
    deriveWizardSteps(capabilities, optOuts, mode),
  );
  const [slots] = useState(() => selectableSlots(capabilities, optOuts, mode));
  const [stepIndex, setStepIndex] = useState(0);

  const goNext = useCallback(
    () => setStepIndex((index) => Math.min(index + 1, steps.length - 1)),
    [steps.length],
  );
  const goBack = useCallback(() => setStepIndex((index) => Math.max(index - 1, 0)), []);
  // Only already-passed steps are reachable from the stepper.
  const goTo = useCallback(
    (target: number) => setStepIndex((index) => (target < index ? target : index)),
    [],
  );

  const provider = useProviderStep(goNext);
  const models = useModelsStep({
    providerId: provider.providerId,
    models: provider.models,
    slots,
    capabilities,
    onSaved: goNext,
  });
  const search = useSearchStep(goNext);

  const current = steps[stepIndex];
  const hasDraft = useMemo(
    () => provider.hasKeyDraft || search.hasDraft,
    [provider.hasKeyDraft, search.hasDraft],
  );

  return {
    steps,
    slots,
    stepIndex,
    current,
    mode,
    hasDraft,
    goNext,
    goBack,
    goTo,
    provider,
    models,
    search,
  };
}

export type SetupWizardState = ReturnType<typeof useSetupWizard>;
