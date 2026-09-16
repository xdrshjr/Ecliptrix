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
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentClientApplyError, OperationRejectReason } from '@/types';
import type { Translations } from '@/lib/i18n';
import {
  describeTtsFailure, getTtsFailure, getLegacyTtsFailure, isTtsRecord,
  type TtsFailure,
} from '@/lib/ttsErrors';
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

// 既有 SVG 变体占用超过 60 行；集中维护便于核对所有状态的占位尺寸。
const StatusIcon: React.FC<{
  status: ToolStepStatus; isPartial: boolean;
}> = ({ status, isPartial }) => {
  const reduced = useReducedMotion();
  if (isPartial) return (
    <svg className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeWidth="2" />
      <path d="M12 7v6m0 3v1" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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
          variants={reduced ? undefined : iconScaleInVariants}
          initial={reduced ? false : 'initial'}
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
          variants={reduced ? undefined : iconScaleInVariants}
          initial={reduced ? false : 'initial'}
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
          transition={{ duration: reduced ? 0 : TIMING.UNDO }}
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
          variants={reduced ? undefined : iconScaleInVariants}
          initial={reduced ? false : 'initial'}
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

interface PresentedFailure { failure: TtsFailure; inputIndex?: number }

function readTtsPresentation(step: ToolStepData, hasApplyError: boolean) {
  const isTts = step.name === 'generate_tts' || step.name === 'batch_generate_tts';
  const result = isTtsRecord(step.result) ? step.result : {};
  const isPartial = isTts && !hasApplyError && step.status === 'completed' &&
    result.success === true && result.partial === true;
  const failures: PresentedFailure[] = [];
  if (!isTts || hasApplyError || step.status === 'cancelled' ||
    step.status === 'undone' || step.status === 'executing') {
    return { isTts, isPartial: false, failures, result };
  }
  if (isPartial && Array.isArray(result.failures)) {
    for (const value of result.failures) {
      const failure = getTtsFailure(value);
      if (!failure || !isTtsRecord(value)) continue;
      const inputIndex = typeof value.input_index === 'number' &&
        Number.isInteger(value.input_index) && value.input_index >= 0
        ? value.input_index : undefined;
      failures.push({ failure, inputIndex });
    }
  } else if (step.status === 'error' || result.success === false) {
    failures.push({ failure: getTtsFailure(result) ?? getLegacyTtsFailure(
      typeof step.result === 'string' ? step.result : result.error,
    ) });
  }
  return { isTts, isPartial, failures, result };
}

function TtsFailureReason({ entry, t }: {
  entry: PresentedFailure; t: Translations;
}) {
  const { summary, action } = describeTtsFailure(entry.failure, t);
  return (
    <div className="space-y-1 text-xs [overflow-wrap:anywhere]">
      {entry.inputIndex !== undefined && <div className="font-medium">
        {t.ttsErrors.segmentFailure.replace('{index}', String(entry.inputIndex + 1))}
      </div>}
      <p className="text-red-600 dark:text-red-400 break-words">{summary}</p>
      {action && <p className="text-muted-foreground break-words">{action}</p>}
    </div>
  );
}

function TtsDiagnostics({ failure, t }: {
  failure: TtsFailure; t: Translations;
}) {
  const { details } = describeTtsFailure(failure, t);
  const copy = t.ttsErrors;
  const fields = [
    [copy.errorCode, failure.error_code],
    [copy.source, details?.source && copy.sources[details.source]],
    [copy.providerMessage, details?.provider_message],
    [copy.providerCode, details?.provider_code],
    [copy.requestId, details?.request_id],
    [copy.attempts, details?.attempts],
    [copy.httpStatus, details?.http_status],
  ];
  return (
    <section className="text-xs space-y-1 [overflow-wrap:anywhere]">
      <h4 className="font-medium text-muted-foreground">{copy.diagnostics}</h4>
      <dl className="space-y-1">
        {fields.filter(([, value]) => value !== undefined).map(([label, value]) => (
          <div key={String(label)} className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {details?.voice_fallback && <p>{copy.voiceFallback}</p>}
    </section>
  );
}

// 保留既有参数、状态与展开结构；TTS 诊断以独立小组件隔离。
const ToolStep: React.FC<ToolStepProps> = ({ step, isLast = false }) => {
  const { t } = useLocale();
  const reduced = useReducedMotion();
  const applyErrorText = formatClientApplyError(step.result, t);
  const tts = readTtsPresentation(step, !!applyErrorText);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [flashClass, setFlashClass] = useState('');
  const prevStatusRef = useRef<ToolStepStatus>(step.status);

  // Detect status transitions for flash animations
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = step.status;

    if (reduced || tts.isPartial || applyErrorText) { setFlashClass(''); return; }
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
  }, [step.status, reduced, tts.isPartial, applyErrorText]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const hasDetails =
    Object.keys(step.params).length > 0 || step.result != null;

  // Results are rendered as text only: stored results carry an
  // "[inline media omitted]" placeholder instead of data: thumbnails, which
  // would show as a broken picture if it ever became an image source.
  const resultText = step.result != null ? formatResult(step.result) : '';
  const summaryText = tts.isTts && applyErrorText ? '' : applyErrorText ?? (
    tts.failures.length || tts.isPartial ? '' : step.summary
  );
  const errorText = applyErrorText ?? resultText;
  const isUndone = step.status === 'undone';
  const isExecuting = step.status === 'executing';
  const isError = step.status === 'error';
  const hasTtsFailurePresentation = tts.failures.length > 0 || tts.isPartial;
  const showOriginalResult = !tts.isTts || (
    !hasTtsFailurePresentation && !applyErrorText &&
    isTtsRecord(step.result) && step.result.success === true
  );

  // Real-time elapsed timer (only ticks while executing)
  const liveElapsed = useElapsedTimer(isExecuting, containerRef);

  // Background classes for different states
  let bgClass = '';
  if (isExecuting) {
    bgClass = 'relative';
  } else if (isError && !tts.isTts) {
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
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 dark:hover:bg-zinc-700/50 transition-colors text-left relative z-[1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={hasDetails ? toggleExpand : undefined}
        disabled={!hasDetails}
        aria-expanded={isExpanded}
      >
        <StatusIcon status={step.status} isPartial={tts.isPartial} />

        <span className={`font-medium text-xs text-foreground dark:text-zinc-200 ${isUndone ? 'line-through decoration-muted-foreground/50' : ''}`}>
          {step.displayName}
        </span>

        {tts.isPartial && <span className="text-xs text-amber-700 dark:text-amber-400">
          {t.ttsErrors.partial}
        </span>}

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
            transition={{ duration: reduced ? 0 : TIMING.ARROW_ROTATE }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        )}
      </button>

      {tts.isTts && applyErrorText && (
        <p className="px-3 pb-2 text-xs text-red-600 dark:text-red-400 break-words">
          {applyErrorText}
        </p>
      )}

      {(tts.isPartial || tts.failures.length > 0) && (
        <div className="px-3 pb-3 space-y-2 relative z-[1]">
          {tts.isPartial && <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {t.ttsErrors.partialSummary
              .replace('{successful}', String(tts.result.successful_segments ?? 0))
              .replace('{total}', String(tts.result.total_segments ?? 0))
              .replace('{failed}', String(tts.result.failed_segments ?? 0))}
          </p>}
          {tts.failures.map((entry, index) => (
            <TtsFailureReason key={index} entry={entry} t={t} />
          ))}
        </div>
      )}

      {/* Expanded details with enhanced animation */}
      <AnimatePresence initial={false}>
        {isExpanded && hasDetails && (
          <motion.div
            key="details"
            variants={reduced ? undefined : expandVariants}
            initial={reduced ? false : 'collapsed'}
            animate="expanded"
            exit={reduced ? undefined : 'collapsed'}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 space-y-1.5 pt-1 relative z-[1]">
              {/* Parameters */}
              {Object.keys(step.params).length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground dark:text-zinc-500 mb-1">
                    {t.agentTimeline.parameters}
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
              {step.result != null && showOriginalResult && (
                <div>
                  <div className="text-xs text-muted-foreground dark:text-zinc-500 mb-1">
                    {t.agentTimeline.result}
                  </div>
                  <div className="bg-background dark:bg-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-foreground dark:text-zinc-300 break-all whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {resultText}
                  </div>
                </div>
              )}

              {/* Error message slide-in */}
              {tts.failures.map((entry, index) => (
                <TtsDiagnostics key={index} failure={entry.failure} t={t} />
              ))}

              {isError && step.result != null && !tts.isTts && (
                <motion.div
                  variants={reduced ? undefined : errorSlideInVariants}
                  initial={reduced ? false : 'initial'}
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
      {isError && !isExpanded && step.result != null && !tts.isTts && (
        <motion.div
          variants={reduced ? undefined : errorSlideInVariants}
          initial={reduced ? false : 'initial'}
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
