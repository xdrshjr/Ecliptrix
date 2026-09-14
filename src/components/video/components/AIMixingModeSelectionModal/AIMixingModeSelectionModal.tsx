'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { Translations } from '@/lib/i18n';
import type { AiMixTimelineImpact } from '../../hooks/useAIMixedEditing';

export interface AIMixingMode {
  type: 'quick' | 'professional';
  frameInterval?: number; // 仅专业模式需要
}

interface AIMixingModeSelectionModalProps {
  isOpen: boolean;
  /** What an AI plan would replace on the current timeline (AM-01). */
  impact: AiMixTimelineImpact;
  onClose: () => void;
  onConfirm: (mode: AIMixingMode) => void;
}

const DEFAULT_FRAME_INTERVAL = 5;
const MIN_FRAME_INTERVAL = 1;
const MAX_FRAME_INTERVAL = 30;
const ENTER_DELAY_MS = 10;
const EXIT_DURATION_MS = 200;
const TITLE_ID = 'ai-mixing-mode-title';
const SUBTITLE_ID = 'ai-mixing-mode-description';
const WARNING_TITLE_ID = 'ai-mixing-replace-warning-title';
const FRAME_INTERVAL_INPUT_ID = 'ai-mixing-frame-interval';
const FRAME_INTERVAL_HINT_ID = 'ai-mixing-frame-interval-hint';
const OWN_DIALOG_SELECTOR = `[role="dialog"][aria-labelledby="${TITLE_ID}"]`;
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Enter on these belongs to them (typing, pressing a button), not "start". */
const ENTER_OWNER_SELECTOR = 'input, textarea, select, button';
const RADIO_MOVE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/** Whole seconds within [1, 30]; anything unparseable falls back to 5. */
export function clampFrameInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FRAME_INTERVAL;
  return Math.min(
    MAX_FRAME_INTERVAL,
    Math.max(MIN_FRAME_INTERVAL, Math.round(value)),
  );
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

function useDialogFocus(
  dialogRef: React.RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  isShown: boolean,
): void {
  // Once on screen, focus the checked mode so arrows / Enter / Esc work.
  useEffect(() => {
    if (!isShown) return undefined;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialogRef, isShown]);

  // On close, hand focus back — unless the progress dialog already took it.
  // Ownership is checked by selector: the dialog node may be gone by then.
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

function trapTabFocus(
  event: React.KeyboardEvent,
  container: HTMLElement | null,
): void {
  if (!container) return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  // Focus on the dialog itself (e.g. after clicking its padding) is not on a
  // control, and the browser would Tab straight out of the dialog from it.
  const isOnControl = focusables.some((element) => element === active);
  if (!isOnControl || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

const isEnterOwner = (target: EventTarget): boolean =>
  target instanceof Element && target.closest(ENTER_OWNER_SELECTOR) !== null;

function IconCheckCircle({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

function IconWarning({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

interface ReplaceWarningProps {
  impact: AiMixTimelineImpact;
  locale: string;
  copy: Translations['aiMixingModal'];
}

function ReplaceWarning({ impact, locale, copy }: ReplaceWarningProps) {
  const names = impact.preservedTrackNames
    .join(locale === 'zh-CN' ? '、' : ', ');
  return (
    <div
      role="note"
      aria-labelledby={WARNING_TITLE_ID}
      className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-amber-700 dark:text-amber-300"
    >
      <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1 text-xs leading-relaxed">
        <p id={WARNING_TITLE_ID} className="text-sm font-medium">
          {copy.replaceWarningTitle}
        </p>
        <p>
          {copy.replaceWarningBody.replace('{count}', String(impact.replaceableItemCount))}
        </p>
        {names && <p>{copy.preservedTracks.replace('{tracks}', names)}</p>}
        <p>{copy.undoHint}</p>
      </div>
    </div>
  );
}

interface ModeOptionProps {
  optionRef: React.RefObject<HTMLDivElement | null>;
  isSelected: boolean;
  title: string;
  description: string;
  highlights: readonly [string, string];
  icon: React.ReactNode;
  onSelect: () => void;
  onSelectOther: () => void;
}

function ModeOption({
  optionRef, isSelected, title, description, highlights, icon, onSelect, onSelectOther,
}: ModeOptionProps) {
  const titleId = useId();
  const descriptionId = useId();
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      event.preventDefault();
      onSelect();
    } else if (event.key === 'Enter') {
      onSelect(); // bubbles on to the dialog, which starts the edit
    } else if (RADIO_MOVE_KEYS.indexOf(event.key) !== -1) {
      event.preventDefault();
      onSelectOther();
    }
  };
  return (
    <div
      ref={optionRef}
      role="radio"
      aria-checked={isSelected}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={isSelected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={`flex cursor-pointer items-start gap-3 rounded-md border-2 p-4 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card motion-reduce:transition-none ${
        isSelected ? 'border-primary bg-accent' : 'border-border hover:bg-muted'
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors motion-reduce:transition-none ${
          isSelected ? 'border-primary bg-primary' : 'border-border'
        }`}
      >
        {isSelected && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          {icon}
          <span id={titleId} className="font-semibold text-foreground">{title}</span>
        </div>
        <p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <IconCheckCircle className="h-3 w-3" />
          <span>{highlights[0]}</span>
          <span aria-hidden="true">•</span>
          <span>{highlights[1]}</span>
        </p>
      </div>
    </div>
  );
}

interface FrameIntervalFieldProps {
  value: string;
  copy: Translations['aiMixingModal'];
  onChange: (value: string) => void;
  onCommit: () => void;
}

/** Free text while typing (so it can be cleared); clamped on blur / Enter. */
function FrameIntervalField({ value, copy, onChange, onCommit }: FrameIntervalFieldProps) {
  return (
    <div className="rounded-md border border-border bg-muted p-3">
      <label htmlFor={FRAME_INTERVAL_INPUT_ID} className="mb-2 block text-sm font-medium text-foreground">
        {copy.frameIntervalLabel}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={FRAME_INTERVAL_INPUT_ID}
          type="number"
          inputMode="numeric"
          min={MIN_FRAME_INTERVAL}
          max={MAX_FRAME_INTERVAL}
          step={1}
          value={value}
          placeholder={String(DEFAULT_FRAME_INTERVAL)}
          aria-describedby={FRAME_INTERVAL_HINT_ID}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit();
          }}
          className="h-9 w-24 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-sm text-muted-foreground">{copy.frameIntervalUnit}</span>
      </div>
      <p id={FRAME_INTERVAL_HINT_ID} className="mt-1.5 text-xs text-muted-foreground">
        {copy.frameIntervalHint}
      </p>
    </div>
  );
}

interface ModeDialogHeaderProps {
  copy: Translations['aiMixingModal'];
  onClose: () => void;
}

function ModeDialogHeader({ copy, onClose }: ModeDialogHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
      <div className="min-w-0">
        <h2 id={TITLE_ID} className="text-lg font-semibold text-foreground">
          {copy.title}
        </h2>
        <p id={SUBTITLE_ID} className="mt-1 text-sm text-muted-foreground">
          {copy.subtitle}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={copy.cancel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </header>
  );
}

interface ModeOptionsProps {
  selectedMode: AIMixingMode['type'];
  copy: Translations['aiMixingModal'];
  quickRef: React.RefObject<HTMLDivElement | null>;
  proRef: React.RefObject<HTMLDivElement | null>;
  onSelectMode: (mode: AIMixingMode['type']) => void;
}

function ModeOptions({ selectedMode, copy, quickRef, proRef, onSelectMode }: ModeOptionsProps) {
  return (
    <div role="radiogroup" aria-labelledby={TITLE_ID} className="space-y-3">
      <ModeOption
        optionRef={quickRef}
        isSelected={selectedMode === 'quick'}
        title={copy.quickMode}
        description={copy.quickModeDesc}
        highlights={[copy.quickModeFast, copy.quickModeLowResource]}
        icon={(
          <svg aria-hidden="true" className="h-5 w-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        onSelect={() => onSelectMode('quick')}
        onSelectOther={() => onSelectMode('professional')}
      />
      <ModeOption
        optionRef={proRef}
        isSelected={selectedMode === 'professional'}
        title={copy.professionalMode}
        description={copy.professionalModeDesc}
        highlights={[copy.professionalModeHighPrecision, copy.professionalModeBetterResults]}
        icon={(
          <svg aria-hidden="true" className="h-5 w-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}
        onSelect={() => onSelectMode('professional')}
        onSelectOther={() => onSelectMode('quick')}
      />
    </div>
  );
}

interface ModeDialogFooterProps {
  copy: Translations['aiMixingModal'];
  onClose: () => void;
  onConfirm: () => void;
}

function ModeDialogFooter({ copy, onClose, onConfirm }: ModeDialogFooterProps) {
  return (
    <footer className="flex items-center justify-end gap-3 rounded-b-lg border-t border-border bg-muted px-6 py-4">
      <button
        type="button"
        onClick={onClose}
        className="h-9 rounded-md border border-border bg-secondary px-4 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        {copy.cancel}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="h-9 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted motion-reduce:transition-none"
      >
        {copy.confirm}
      </button>
    </footer>
  );
}

// Over 60 lines: the shell owns the presence animation, the keyboard contract
// (Esc / Tab / Enter) and the backdrop-dismiss rule, which only work together.
const AIMixingModeSelectionModal: React.FC<AIMixingModeSelectionModalProps> = ({
  isOpen,
  impact,
  onClose,
  onConfirm,
}) => {
  const { t, locale } = useLocale();
  const { isMounted, isShown } = usePresence(isOpen);
  const [selectedMode, setSelectedMode] = useState<AIMixingMode['type']>('quick');
  const [frameIntervalInput, setFrameIntervalInput] = useState(
    String(DEFAULT_FRAME_INTERVAL),
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const proRef = useRef<HTMLDivElement>(null);
  // A drag that starts inside the dialog and ends on the backdrop is not a dismiss.
  const pressStartedOnBackdropRef = useRef(false);
  useDialogFocus(dialogRef, isOpen, isShown);

  if (!isMounted) return null;

  const copy = t.aiMixingModal;

  const commitFrameInterval = (): number => {
    const value = clampFrameInterval(parseInt(frameIntervalInput, 10));
    setFrameIntervalInput(String(value));
    return value;
  };

  const handleConfirm = () => {
    const frameInterval = commitFrameInterval();
    onConfirm(selectedMode === 'professional'
      ? { type: 'professional', frameInterval }
      : { type: 'quick' });
  };

  const selectMode = (mode: AIMixingMode['type']) => {
    setSelectedMode(mode);
    (mode === 'quick' ? quickRef : proRef).current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      trapTabFocus(event, dialogRef.current);
    } else if (event.key === 'Enter' && !isEnterOwner(event.target)) {
      event.preventDefault();
      handleConfirm();
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-colors duration-200 motion-reduce:transition-none ${
        isShown ? 'bg-black/60' : 'bg-black/0'
      }`}
      onMouseDown={(event) => {
        pressStartedOnBackdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressStartedOnBackdropRef.current && event.target === event.currentTarget) {
          onClose();
        }
        pressStartedOnBackdropRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={SUBTITLE_ID}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col rounded-lg border border-border bg-card text-card-foreground shadow-xl outline-none transition duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none ${
          isShown ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        <ModeDialogHeader copy={copy} onClose={onClose} />

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {impact.replaceableItemCount > 0 && (
            <ReplaceWarning impact={impact} locale={locale} copy={copy} />
          )}

          <ModeOptions
            selectedMode={selectedMode}
            copy={copy}
            quickRef={quickRef}
            proRef={proRef}
            onSelectMode={selectMode}
          />

          {selectedMode === 'professional' && (
            <FrameIntervalField
              value={frameIntervalInput}
              copy={copy}
              onChange={setFrameIntervalInput}
              onCommit={commitFrameInterval}
            />
          )}
        </div>

        <ModeDialogFooter copy={copy} onClose={onClose} onConfirm={handleConfirm} />
      </div>
    </div>
  );
};

export default AIMixingModeSelectionModal;
