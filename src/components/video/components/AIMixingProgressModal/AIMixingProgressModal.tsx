'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { Translations } from '@/lib/i18n';
import type { AiMixRunState, AiMixStage } from '../../hooks/useAIMixedEditing';

interface AIMixingProgressModalProps {
  runState: AiMixRunState;
  onCancel: () => void;
}

type StepStage = 'analyzing' | 'planning' | 'applying';
type StepStatus = 'done' | 'active' | 'pending';

const STEP_STAGES: readonly StepStage[] = ['analyzing', 'planning', 'applying'];
const OPEN_STAGES: readonly AiMixStage[] = [...STEP_STAGES, 'done'];
const ENTER_DELAY_MS = 10;
const EXIT_DURATION_MS = 200;
const TITLE_ID = 'ai-mixing-progress-title';
const STATUS_ID = 'ai-mixing-progress-status';
const OWN_DIALOG_SELECTOR = `[role="dialog"][aria-labelledby="${TITLE_ID}"]`;

const STEP_LABEL_CLASSES: Record<StepStatus, string> = {
  done: 'text-foreground',
  active: 'font-medium text-foreground',
  pending: 'text-muted-foreground',
};

function getStepStatus(step: StepStage, stage: AiMixStage): StepStatus {
  if (stage === 'done') return 'done';
  const activeIndex = (STEP_STAGES as readonly AiMixStage[]).indexOf(stage);
  const stepIndex = STEP_STAGES.indexOf(step);
  if (activeIndex === -1 || stepIndex > activeIndex) return 'pending';
  return stepIndex === activeIndex ? 'active' : 'done';
}

/** Mount immediately, animate in next tick; animate out, then unmount. */
function usePresence(isOpen: boolean): { isMounted: boolean; isShown: boolean } {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isShown, setIsShown] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      const timer = window.setTimeout(() => setIsShown(true), ENTER_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
    setIsShown(false);
    const timer = window.setTimeout(() => setIsMounted(false), EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen]);
  return { isMounted, isShown };
}

/**
 * On close, hand focus back — unless another dialog has already taken it.
 * Ownership is checked by selector: the dialog node may not exist yet when
 * the effect starts (it mounts one render after opening).
 */
function useRestoreFocusOnClose(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.activeElement;
    return () => {
      const active = document.activeElement;
      const isFocusOurs = !active
        || active === document.body
        || active.closest(OWN_DIALOG_SELECTOR) !== null;
      if (isFocusOurs && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [isOpen]);
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function SparklesIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
      <path d="M19 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8L19 15z" />
    </svg>
  );
}

function StepIndicator({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
          className="h-6 w-6 animate-spin text-primary motion-reduce:animate-none">
          <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" className="text-border" />
          <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
    </span>
  );
}

interface ProgressStepProps {
  status: StepStatus;
  label: string;
  hint?: string;
  hasConnector: boolean;
}

function ProgressStep({ status, label, hint, hasConnector }: ProgressStepProps) {
  return (
    <li
      className="relative flex gap-3 pb-5 last:pb-2"
      aria-current={status === 'active' ? 'step' : undefined}
    >
      {hasConnector && (
        <span
          aria-hidden="true"
          className={`absolute bottom-1 left-3 top-7 w-px -translate-x-1/2 transition-colors duration-300 motion-reduce:transition-none ${
            status === 'done' ? 'bg-primary' : 'bg-border'
          }`}
        />
      )}
      <StepIndicator status={status} />
      <div className="min-w-0 pt-0.5">
        <p className={`text-sm leading-5 ${STEP_LABEL_CLASSES[status]}`}>{label}</p>
        {status === 'active' && hint && (
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{hint}</p>
        )}
      </div>
    </li>
  );
}

type StepCopy = Record<StepStage, { label: string; hint?: string }>;

/** Step labels, plus the hint shown under whichever step is active. */
function describeSteps(
  copy: Translations['aiMixingProgress'],
  shown: AiMixRunState,
): StepCopy {
  return {
    analyzing: {
      label: copy.stepAnalyze,
      hint: shown.videoCount > 0
        ? copy.analyzingVideos.replace('{count}', String(shown.videoCount))
        : undefined,
    },
    planning: { label: copy.stepPlan, hint: copy.planningHint },
    applying: { label: copy.stepApply },
  };
}

function ProgressDialogHeader({ isDone, title }: { isDone: boolean; title: string }) {
  return (
    <div className="flex items-center gap-3 px-6 pt-6">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200 motion-reduce:transition-none ${
          isDone ? 'bg-primary text-primary-foreground' : 'bg-accent text-primary'
        }`}
      >
        {isDone
          ? <CheckIcon className="h-5 w-5" />
          : <SparklesIcon className="h-5 w-5" />}
      </span>
      <h2 id={TITLE_ID} className="text-base font-semibold leading-6 text-foreground">
        {title}
      </h2>
    </div>
  );
}

interface ProgressDialogFooterProps {
  isDone: boolean;
  isOpen: boolean;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  copy: Translations['aiMixingProgress'];
  onCancel: () => void;
}

function ProgressDialogFooter({
  isDone, isOpen, cancelRef, copy, onCancel,
}: ProgressDialogFooterProps) {
  return (
    <div className="mt-2 flex h-16 items-center justify-end border-t border-border px-6">
      {isDone ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          <CheckIcon className="h-4 w-4" />
          {copy.done}
        </span>
      ) : (
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={!isOpen}
          className="h-9 rounded-md border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none"
        >
          {copy.cancel}
        </button>
      )}
    </div>
  );
}

/**
 * Progress for AI auto edit: three honest steps (no fake percentage — the
 * backend reports none), cancellable while running, Escape cancels, and the
 * backdrop never dismisses a running edit.
 *
 * Over 60 lines: the shell keeps the last visible state through the exit
 * animation and owns the focus / keyboard contract, which belong together.
 */
const AIMixingProgressModal: React.FC<AIMixingProgressModalProps> = ({
  runState,
  onCancel,
}) => {
  const { t } = useLocale();
  const isOpen = OPEN_STAGES.indexOf(runState.stage) !== -1;
  const { isMounted, isShown } = usePresence(isOpen);
  // While fading out after cancel / error, keep the last visible state.
  const [lastOpenState, setLastOpenState] = useState(runState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const isCancellable = isOpen && runState.stage !== 'done';

  useEffect(() => {
    if (isOpen) setLastOpenState(runState);
  }, [isOpen, runState]);

  useRestoreFocusOnClose(isOpen);

  useEffect(() => {
    if (!isMounted || !isOpen) return;
    (cancelRef.current ?? dialogRef.current)?.focus();
  }, [isMounted, isOpen, isCancellable]);

  if (!isMounted) return null;

  const copy = t.aiMixingProgress;
  const shown = isOpen ? runState : lastOpenState;
  const isDone = shown.stage === 'done';
  const steps = describeSteps(copy, shown);
  const activeStep = STEP_STAGES
    .filter((step) => getStepStatus(step, shown.stage) === 'active')[0];

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (isCancellable) onCancel();
    } else if (event.key === 'Tab') {
      // Cancel is the only control, so Tab must not leave the dialog.
      event.preventDefault();
      (cancelRef.current ?? dialogRef.current)?.focus();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-colors duration-200 motion-reduce:transition-none ${
        isShown ? 'bg-black/60' : 'bg-black/0'
      }`}
      onMouseDown={(event) => {
        // The backdrop never closes a running edit; keep focus in the dialog.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={STATUS_ID}
        aria-busy={!isDone}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-sm rounded-lg border border-border bg-card text-card-foreground shadow-xl outline-none transition duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none ${
          isShown ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <ProgressDialogHeader isDone={isDone} title={copy.title} />

        <ol className="px-6 pb-1 pt-5">
          {STEP_STAGES.map((step, index) => (
            <ProgressStep
              key={step}
              status={getStepStatus(step, shown.stage)}
              label={steps[step].label}
              hint={steps[step].hint}
              hasConnector={index < STEP_STAGES.length - 1}
            />
          ))}
        </ol>

        <p id={STATUS_ID} role="status" aria-live="polite" className="sr-only">
          {isDone && copy.done}
          {activeStep && <span>{steps[activeStep].label}</span>}
          {activeStep && steps[activeStep].hint && <span> {steps[activeStep].hint}</span>}
        </p>

        <ProgressDialogFooter
          isDone={isDone}
          isOpen={isOpen}
          cancelRef={cancelRef}
          copy={copy}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
};

export default AIMixingProgressModal;
