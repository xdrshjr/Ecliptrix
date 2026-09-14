/**
 * ToolStep — renders a single tool call execution step inside an AgentExecutionNode.
 *
 * Shows a compact row with status icon, tool name, elapsed time, and one-line summary.
 * Clicking expands to reveal full parameters and result JSON.
 *
 * Enhanced animations (Spec 05):
 * - Expand/collapse: height 200ms, content fade 150ms delayed 50ms, arrow 180°
 * - Executing state: spinner icon, background pulse, real-time elapsed timer
 * - Complete transition: checkmark spring scale-in + green background flash
 * - Error transition: X icon + red background flash + shake + error message slide-in
 * - Undo state: gray background, strikethrough, opacity 0.5
 * - IntersectionObserver pauses the elapsed timer when offscreen
 *
 * @module timeline/ToolStep
 */

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentClientApplyError, OperationRejectReason } from '@/types';
import type { Translations } from '@/lib/i18n';
import type { ToolStepData, ToolStepStatus } from './types';
import { formatElapsedTime, formatParamValue, formatResult } from './utils';
import {
  expandVariants,
  iconScaleInVariants,
  errorSlideInVariants,
  CSS_ANIMATIONS,
  TIMING,
  EASING,
} from './animations';

// ---------------------------------------------------------------------------
// Status icon sub-component — enhanced with framer-motion transitions
// ---------------------------------------------------------------------------

const StatusIcon: React.FC<{ status: ToolStepStatus }> = ({ status }) => {
  switch (status) {
    case 'executing':
      return (
        <svg
          className={`w-3.5 h-3.5 text-primary flex-shrink-0 ${CSS_ANIMATIONS.spin}`}
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      );

    case 'completed':
      return (
        <motion.svg
          className="w-3.5 h-3.5 text-green-500 dark:text-green-400 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          variants={iconScaleInVariants}
          initial="initial"
          animate="animate"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </motion.svg>
      );

    case 'error':
      return (
        <motion.svg
          className="w-3.5 h-3.5 text-red-500 dark:text-red-400 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          variants={iconScaleInVariants}
          initial="initial"
          animate="animate"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </motion.svg>
      );

    case 'undone':
      return (
        <motion.svg
          className="w-3.5 h-3.5 text-muted-foreground/60 dark:text-zinc-500 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0.6 }}
          transition={{ duration: TIMING.UNDO }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </motion.svg>
      );

    case 'cancelled':
      return (
        <motion.svg
          className="w-3.5 h-3.5 text-muted-foreground dark:text-zinc-500 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          variants={iconScaleInVariants}
          initial="initial"
          animate="animate"
        >
          <circle cx="12" cy="12" r="9" strokeWidth={2} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l6 6m0-6l-6 6" />
        </motion.svg>
      );
  }
};

// ---------------------------------------------------------------------------
// useElapsedTimer — real-time elapsed timer with IntersectionObserver pause
// ---------------------------------------------------------------------------

function useElapsedTimer(
  isExecuting: boolean,
  containerRef: React.RefObject<HTMLDivElement | null>,
): string {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(Date.now());
  const isVisibleRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset start time when execution begins
  useEffect(() => {
    if (isExecuting) {
      startRef.current = Date.now();
      setElapsed(0);
    }
  }, [isExecuting]);

  // Timer with visibility-aware pause
  useEffect(() => {
    if (!isExecuting) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      if (isVisibleRef.current) {
        setElapsed(Date.now() - startRef.current);
      }
    }, TIMING.ELAPSED_TIMER_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isExecuting]);

  // IntersectionObserver to pause when offscreen
  useEffect(() => {
    if (!isExecuting) return;

    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isExecuting]);

  return isExecuting ? formatElapsedTime(elapsed) : '';
}

// ---------------------------------------------------------------------------
// Client apply error — the tool succeeded but the timeline refused its change
// ---------------------------------------------------------------------------

const REJECT_REASON_KEYS: Record<
  OperationRejectReason,
  keyof Translations['agentApply']['reasons']
> = {
  'clip-not-found': 'clipNotFound',
  'track-not-found': 'trackNotFound',
  'target-track-missing': 'targetTrackMissing',
  'invalid-time': 'invalidTime',
};

function readClientApplyError(result: unknown): AgentClientApplyError | null {
  if (result === null || typeof result !== 'object') return null;
  const candidate = (result as { clientApplyError?: unknown }).clientApplyError;
  if (candidate === null || typeof candidate !== 'object') return null;
  const reason = (candidate as { reason?: unknown }).reason;
  return typeof reason === 'string' && reason in REJECT_REASON_KEYS
    ? (candidate as AgentClientApplyError)
    : null;
}

/** Localised "not applied · reason" text, or null when the step applied normally. */
function formatClientApplyError(result: unknown, t: Translations): string | null {
  const applyError = readClientApplyError(result);
  if (!applyError) return null;
  const reason = t.agentApply.reasons[REJECT_REASON_KEYS[applyError.reason]];
  return `${t.agentApply.notApplied} · ${reason}`;
}

// ---------------------------------------------------------------------------
// ToolStep component
// ---------------------------------------------------------------------------

interface ToolStepProps {
  step: ToolStepData;
  /** Whether this is the last step in the list (suppress bottom border). */
  isLast?: boolean;
}

const ToolStep: React.FC<ToolStepProps> = ({ step, isLast = false }) => {
  const { t } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [flashClass, setFlashClass] = useState('');
  const prevStatusRef = useRef<ToolStepStatus>(step.status);

  // Detect status transitions for flash animations
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = step.status;

    if (prev === 'executing' && step.status === 'completed') {
      setFlashClass(CSS_ANIMATIONS.flashGreen);
      const timer = setTimeout(() => setFlashClass(''), 400);
      return () => clearTimeout(timer);
    }
    if (prev === 'executing' && step.status === 'error') {
      setFlashClass(`${CSS_ANIMATIONS.flashRed} ${CSS_ANIMATIONS.shake}`);
      const timer = setTimeout(() => setFlashClass(''), 400);
      return () => clearTimeout(timer);
    }
  }, [step.status]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const hasDetails =
    Object.keys(step.params).length > 0 || step.result != null;

  // Results are rendered as text only: stored results carry an
  // "[inline media omitted]" placeholder instead of data: thumbnails, which
  // would show as a broken picture if it ever became an image source.
  const resultText = step.result != null ? formatResult(step.result) : '';
  const applyErrorText = formatClientApplyError(step.result, t);
  const summaryText = applyErrorText ?? step.summary;
  const errorText = applyErrorText ?? resultText;
  const isUndone = step.status === 'undone';
  const isExecuting = step.status === 'executing';
  const isError = step.status === 'error';

  // Real-time elapsed timer (only ticks while executing)
  const liveElapsed = useElapsedTimer(isExecuting, containerRef);

  // Background classes for different states
  let bgClass = '';
  if (isExecuting) {
    bgClass = 'relative';
  } else if (isError) {
    bgClass = 'bg-red-50/50 dark:bg-red-900/5';
  }

  return (
    <div
      ref={containerRef}
      className={`${!isLast ? 'border-b border-border dark:border-zinc-700' : ''} ${isUndone ? 'opacity-50 bg-muted/30 dark:bg-zinc-800/30' : ''} ${bgClass} ${flashClass}`}
    >
      {/* Background pulse overlay for executing state */}
      {isExecuting && (
        <div className={`absolute inset-0 bg-primary/5 dark:bg-primary/10 ${CSS_ANIMATIONS.bgPulse} pointer-events-none rounded`} />
      )}

      {/* Compact row */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 dark:hover:bg-zinc-700/50 transition-colors text-left relative z-[1]"
        onClick={hasDetails ? toggleExpand : undefined}
        disabled={!hasDetails}
        aria-expanded={isExpanded}
      >
        <StatusIcon status={step.status} />

        <span className={`font-medium text-xs text-foreground dark:text-zinc-200 ${isUndone ? 'line-through decoration-muted-foreground/50' : ''}`}>
          {step.displayName}
        </span>

        {/* One-line summary (collapsed only) */}
        {!isExpanded && summaryText && !isExecuting && (
          <span className="text-muted-foreground dark:text-zinc-400 truncate flex-1 text-xs">
            {summaryText}
          </span>
        )}

        {/* Live elapsed time while executing */}
        {isExecuting && liveElapsed && (
          <span className="text-primary/70 dark:text-primary/60 text-xs flex-shrink-0 tabular-nums">
            {liveElapsed}
          </span>
        )}

        {/* Static elapsed time after completion */}
        {!isExecuting && step.elapsedMs !== null && (
          <span className="text-muted-foreground dark:text-zinc-500 text-xs flex-shrink-0 tabular-nums">
            {formatElapsedTime(step.elapsedMs)}
          </span>
        )}

        {/* Expand chevron with rotation animation */}
        {hasDetails && !isExecuting && (
          <motion.svg
            className="w-3 h-3 text-muted-foreground dark:text-zinc-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: TIMING.ARROW_ROTATE }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        )}
      </button>

      {/* Expanded details with enhanced animation */}
      <AnimatePresence initial={false}>
        {isExpanded && hasDetails && (
          <motion.div
            key="details"
            variants={expandVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 space-y-1.5 pt-1 relative z-[1]">
              {/* Parameters */}
              {Object.keys(step.params).length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground dark:text-zinc-500 mb-1">
                    Parameters
                  </div>
                  <div className="bg-background dark:bg-zinc-800 rounded px-2 py-1.5 text-xs font-mono space-y-0.5">
                    {Object.entries(step.params).map(([key, val]) => (
                      <div key={key} className="flex gap-1">
                        <span className="text-primary dark:text-primary/80">{key}:</span>
                        <span className="text-foreground dark:text-zinc-300 break-all">
                          {formatParamValue(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Result */}
              {step.result != null && (
                <div>
                  <div className="text-xs text-muted-foreground dark:text-zinc-500 mb-1">
                    Result
                  </div>
                  <div className="bg-background dark:bg-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-foreground dark:text-zinc-300 break-all whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {resultText}
                  </div>
                </div>
              )}

              {/* Error message slide-in */}
              {isError && step.result != null && (
                <motion.div
                  variants={errorSlideInVariants}
                  initial="initial"
                  animate="animate"
                  className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/15 rounded px-2 py-1.5"
                >
                  {errorText}
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Inline error summary (when collapsed) */}
      {isError && !isExpanded && step.result != null && (
        <motion.div
          variants={errorSlideInVariants}
          initial="initial"
          animate="animate"
          className="px-3 pb-2 relative z-[1]"
        >
          <div className="text-xs text-red-500 dark:text-red-400 truncate">
            {errorText}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ToolStep;
