'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { isGap, type CapabilityId, type CapabilityStatus } from '@/lib/api/setupStatus';
import { notifySetupConfigUpdated, type SetupWizardFocus } from '@/lib/setupEvents';
import { addOptOut, removeOptOut } from '@/lib/setupOptOut';
import { groupOfIntegration } from './integrationGroups';
import {
  deriveWizardSteps,
  selectableSlots,
  type SourceChoice,
  type SourceModeState,
  type WizardMode,
  type WizardSourceOptions,
  type WizardStepId,
} from './wizardSteps';
import { useModelsStep } from './useModelsStep';
import { useProviderStep } from './useProviderStep';
import { useSearchStep } from './useSearchStep';

interface SetupWizardArgs {
  capabilities: CapabilityStatus[];
  optOuts: CapabilityId[];
  mode: WizardMode;
  /** Manual re-runs from a "go configure" button: jump to this step. */
  focus?: SetupWizardFocus;
  /**
   * Saved capability source. Omitted = the pre-SkillRouter wizard (no source
   * step), which is what a backend without the router endpoint gets.
   */
  sourceMode?: SourceModeState;
}

/** Where to start: the overview, the router step, or the group step of `focus`. */
function initialStepIndex(
  steps: readonly WizardStepId[],
  mode: WizardMode,
  focus: SetupWizardFocus | undefined,
): number {
  if (mode !== 'manual' || !focus) return 0;
  const target = steps.indexOf(
    focus === 'skillrouter' ? 'router' : groupOfIntegration(focus),
  );
  return target >= 0 ? target : 0;
}

/** The card pre-selected on the source step: the saved source, else the router. */
function initialChoice(
  sourceMode: SourceModeState | undefined,
  focus: SetupWizardFocus | undefined,
): SourceChoice {
  if (focus === 'skillrouter') return 'router';
  return sourceMode === 'manual' ? 'manual' : 'router';
}

function sourceOptions(
  sourceMode: SourceModeState | undefined,
  choice: SourceChoice,
  focus: SetupWizardFocus | undefined,
): WizardSourceOptions | undefined {
  return sourceMode ? { sourceMode, choice, focus } : undefined;
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
export function useSetupWizard({
  capabilities,
  optOuts,
  mode,
  focus,
  sourceMode,
}: SetupWizardArgs) {
  const local = useLocalOptOuts(optOuts);
  const [choice, setChoice] = useState<SourceChoice>(() =>
    initialChoice(sourceMode, focus),
  );
  // Frozen at open: a status refetch after the first write must not reshuffle
  // the stepper while the user is mid-flow (skipOptional and the source card
  // are the exceptions: both are the user's own, immediate choice).
  const [steps, setSteps] = useState<WizardStepId[]>(() =>
    deriveWizardSteps(
      capabilities,
      optOuts,
      mode,
      undefined,
      sourceOptions(sourceMode, choice, focus),
    ),
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
    setSteps(
      deriveWizardSteps(
        capabilities,
        next,
        mode,
        false,
        sourceOptions(sourceMode, choice, focus),
      ),
    );
    setStepIndex(1);
  }, [capabilities, local, mode, sourceMode, choice, focus]);

  /** Flip the source card: the stepper previews the branch it leads to. */
  const selectChoice = useCallback(
    (next: SourceChoice) => {
      setChoice(next);
      setSteps(
        deriveWizardSteps(
          capabilities,
          local.optOuts,
          mode,
          undefined,
          sourceOptions(sourceMode, next, focus),
        ),
      );
    },
    [capabilities, local.optOuts, mode, sourceMode, focus],
  );

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
  // Saving the key on the "set up by hand" step must not leave that step: the
  // user may still have the other two cards to go through.
  const currentRef = useRef<WizardStepId | undefined>(undefined);
  const onSearchDone = useCallback(() => {
    if (currentRef.current !== 'manualOnly') goNext();
  }, [goNext]);
  const search = useSearchStep(onSearchDone);

  const current = steps[stepIndex];
  currentRef.current = current;
  const hasDraft =
    provider.hasKeyDraft || search.hasDraft || draftingIntegrations.length > 0;

  return {
    steps,
    slots,
    stepIndex,
    current,
    mode,
    focus,
    sourceMode: sourceMode ?? 'manual',
    choice,
    selectChoice,
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
