'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { looksVisionCapable } from './modelHints';
import Spinner from './Spinner';
import StepHeading from './StepHeading';
import type { SlotStatus } from './slotSave';
import type { SetupWizardState } from './useSetupWizard';
import {
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  ERROR_TEXT,
  FIELD_INPUT,
  TEXT_LINK,
} from './wizardStyles';
import { MODEL_SLOTS } from './wizardSteps';

interface ModelsStepProps {
  wizard: SetupWizardState;
}

const StatusMark: React.FC<{ status?: SlotStatus; label: string }> = ({ status, label }) => {
  if (status === 'saving') {
    return (
      <span className="text-muted-foreground" role="status" aria-label={label}>
        <Spinner />
      </span>
    );
  }
  if (status === 'ok') {
    return (
      <span role="status" className="text-green-600 dark:text-green-400">
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return null;
};

// Over the 50-line function guideline on purpose: one wizard step is one <form>;
// splitting it would only move JSX between files without isolating any logic.
const ModelsStep: React.FC<ModelsStepProps> = ({ wizard }) => {
  const copy = useLocale().t.setupWizard;
  const { models: step, provider } = wizard;
  const visionLikely = looksVisionCapable(step.mainModel);
  const ordered = MODEL_SLOTS.filter((slot) => wizard.slots.includes(slot));
  const chatSelected = step.chosen.includes('chat');
  const savingLabel = chatSelected ? copy.savingChat : copy.saving;
  const chatError = step.chatBlocked ? step.errors.chat : undefined;
  const canContinueAnyway = step.hasAttempted && !step.saving && !step.chatBlocked && step.hasFailure;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step.canSave) void step.save();
  };

  return (
    <form onSubmit={handleSubmit} aria-busy={step.saving}>
      <StepHeading title={copy.modelsTitle} description={copy.modelsDesc} />

      <div className="mt-5">
        <label htmlFor="setup-main-model" className="block text-sm font-medium text-foreground">
          {copy.mainModel}
        </label>
        <input
          id="setup-main-model"
          list="setup-model-options"
          value={step.mainModel}
          onChange={(event) => step.setMainModel(event.target.value)}
          disabled={step.saving}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder={provider.models.length === 0 ? copy.manualModel : undefined}
          className={`mt-1.5 ${FIELD_INPUT}`}
        />
        <datalist id="setup-model-options">
          {provider.models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        {provider.models.length === 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">{copy.err.noModelList}</p>
        )}
      </div>

      <fieldset className="mt-6" disabled={step.saving}>
        <legend className="text-sm font-medium text-foreground">{copy.useSameForAll}</legend>
        <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
          {ordered.map((slot) => {
            const status = step.status[slot];
            const rowError = step.errors[slot];
            return (
              <li key={slot} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <input
                    id={`setup-slot-${slot}`}
                    type="checkbox"
                    checked={step.enabled[slot] ?? false}
                    onChange={(event) => step.toggleSlot(slot, event.target.checked)}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <label htmlFor={`setup-slot-${slot}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block text-sm font-medium text-foreground">
                      {copy.cap[slot].name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {copy.cap[slot].desc}
                    </span>
                  </label>
                  <StatusMark status={status} label={copy.state.ready} />
                  {status === 'error' && !step.chatBlocked && (
                    <button
                      type="button"
                      onClick={() => void step.retry(slot)}
                      className={TEXT_LINK}
                    >
                      {copy.retry}
                    </button>
                  )}
                </div>
                {slot === 'vision' && step.enabled.vision && (
                  <p className={`mt-1.5 pl-7 text-xs ${visionLikely ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    {visionLikely ? copy.visionLikely : copy.visionHint}
                  </p>
                )}
                {rowError && slot !== 'chat' && (
                  <p role="alert" className={`${ERROR_TEXT} pl-7`}>
                    {copy.err.slotFailed} {rowError}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {chatError && (
        <div role="alert" className={ERROR_TEXT}>
          <p>{copy.err.chatFailed}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{chatError}</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button type="button" onClick={wizard.goBack} disabled={step.saving} className={BUTTON_GHOST}>
          {step.chatBlocked ? copy.backToKey : copy.back}
        </button>
        {canContinueAnyway ? (
          <button type="button" onClick={step.proceedAnyway} className={BUTTON_PRIMARY}>
            {copy.next}
          </button>
        ) : (
          <button type="submit" disabled={!step.canSave} className={BUTTON_PRIMARY}>
            {step.saving && <Spinner />}
            {step.saving ? savingLabel : copy.saveContinue}
          </button>
        )}
      </div>
    </form>
  );
};

export default ModelsStep;
