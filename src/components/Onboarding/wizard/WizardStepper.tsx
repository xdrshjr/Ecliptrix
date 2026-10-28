'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { WizardStepId } from './wizardSteps';

interface WizardStepperProps {
  steps: WizardStepId[];
  stepIndex: number;
  /** Only steps before the current one are clickable (no skipping ahead). */
  onGoTo: (index: number) => void;
}

const STEP_LABEL_KEY = {
  overview: 'stepOverview',
  provider: 'stepProvider',
  models: 'stepModels',
  search: 'stepSearch',
  done: 'stepDone',
} as const;

/** Vertical stepper on wide windows; compact counter + bar below 640px. */
const WizardStepper: React.FC<WizardStepperProps> = ({ steps, stepIndex, onGoTo }) => {
  const { t } = useLocale();
  const copy = t.setupWizard;
  const counter = copy.stepCounter
    .replace('{current}', String(stepIndex + 1))
    .replace('{total}', String(steps.length));

  return (
    <>
      <div className="sm:hidden">
        <div className="text-xs font-medium text-muted-foreground">{counter}</div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <nav aria-label={copy.title} className="hidden sm:block">
        <ol className="space-y-1">
          {steps.map((step, index) => {
            const done = index < stepIndex;
            const active = index === stepIndex;
            const label = copy[STEP_LABEL_KEY[step]];
            return (
              <li key={step}>
                <button
                  type="button"
                  onClick={() => onGoTo(index)}
                  disabled={!done}
                  aria-current={active ? 'step' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                    active
                      ? 'bg-accent font-medium text-foreground'
                      : done
                        ? 'text-foreground hover:bg-accent/60'
                        : 'cursor-default text-muted-foreground'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      done
                        ? 'bg-primary text-primary-foreground'
                        : active
                          ? 'border-2 border-primary text-primary'
                          : 'border border-border text-muted-foreground'
                    }`}
                  >
                    {done ? (
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
};

export default WizardStepper;
