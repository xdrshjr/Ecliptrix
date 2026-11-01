'use client';

import { useCallback, useMemo, useState } from 'react';
import type { IntegrationId } from '@/lib/api/integrations';
import { isGap, type CapabilityId, type CapabilityStatus } from '@/lib/api/setupStatus';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';
import { addOptOut, removeOptOut } from '@/lib/setupOptOut';
import { groupOfIntegration } from './integrationGroups';
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
  /** Manual re-runs from a "go configure" button: jump to this integration. */
  focus?: IntegrationId;
}

/** Where to start: the overview, or the group step holding `focus`. */
function initialStepIndex(
  steps: readonly WizardStepId[],
  mode: WizardMode,
  focus: IntegrationId | undefined,
): number {
  if (mode !== 'manual' || !focus) return 0;
  const target = steps.indexOf(groupOfIntegration(focus));
  return target >= 0 ? target : 0;
}

/**
 * Opt-outs the user changed since the wizard opened, layered over the ones the
 * page read from storage. Kept local so the step list can be re-derived the
 * moment "only set up models" is pressed, without waiting for a status refetch.
 */
function useLocalOptOuts(optOuts: CapabilityId[]) {
  const [added, setAdded] = useState<CapabilityId[]>([]);
  const [removed, setRemoved] = useState<CapabilityId[]>([]);

  const effective = useMemo(
    () =>
      Array.from(new Set([...optOuts, ...added])).filter((id) => !removed.includes(id)),
    [optOuts, added, removed],
  );

  const optOut = useCallback((ids: readonly CapabilityId[]) => {
    ids.forEach((id) => addOptOut(id));
    setAdded((current) => Array.from(new Set([...current, ...ids])));
    setRemoved((current) => current.filter((id) => !ids.includes(id)));
    notifySetupConfigUpdated();
  }, []);

  const reenable = useCallback((ids: readonly CapabilityId[]) => {
    ids.forEach((id) => removeOptOut(id));
    setRemoved((current) => Array.from(new Set([...current, ...ids])));
    setAdded((current) => current.filter((id) => !ids.includes(id)));
    notifySetupConfigUpdated();
  }, []);

  return { optOuts: effective, optOut, reenable };
}

/**
 * State for the whole wizard: step list, navigation, and one hook per
 * data-bearing step. No UI here — see the step components.
 */
export function useSetupWizard({ capabilities, optOuts, mode, focus }: SetupWizardArgs) {
  const local = useLocalOptOuts(optOuts);
  // Frozen at open: a status refetch after the first write must not reshuffle
  // the stepper while the user is mid-flow (skipOptional is the one exception).
  const [steps, setSteps] = useState<WizardStepId[]>(() =>
    deriveWizardSteps(capabilities, optOuts, mode),
  );
  const [slots] = useState(() => selectableSlots(capabilities, optOuts, mode));
  const [stepIndex, setStepIndex] = useState(() => initialStepIndex(steps, mode, focus));
  const [draftingIntegrations, setDraftingIntegrations] = useState<string[]>([]);

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

  /** "Only set up models": mute every open extended gap and re-derive the steps. */
  const skipOptional = useCallback(() => {
    const targets = capabilities
      .filter((item) => item.tier === 'extended' && isGap(item))
      .map((item) => item.id)
      .filter((id) => !local.optOuts.includes(id));
    local.optOut(targets);
    const next = Array.from(new Set([...local.optOuts, ...targets]));
    setSteps(deriveWizardSteps(capabilities, next, mode, false));
    setStepIndex(1);
  }, [capabilities, local, mode]);

  const reportIntegrationDraft = useCallback((id: string, hasDraft: boolean) => {
    setDraftingIntegrations((current) => {
      const has = current.includes(id);
      if (hasDraft === has) return current;
      return hasDraft ? [...current, id] : current.filter((item) => item !== id);
    });
  }, []);

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
  const hasDraft =
    provider.hasKeyDraft || search.hasDraft || draftingIntegrations.length > 0;

  return {
    steps,
    slots,
    stepIndex,
    current,
    mode,
    focus,
    optOuts: local.optOuts,
    optOut: local.optOut,
    reenable: local.reenable,
    hasDraft,
    goNext,
    goBack,
    goTo,
    skipOptional,
    reportIntegrationDraft,
    provider,
    models,
    search,
  };
}

export type SetupWizardState = ReturnType<typeof useSetupWizard>;
