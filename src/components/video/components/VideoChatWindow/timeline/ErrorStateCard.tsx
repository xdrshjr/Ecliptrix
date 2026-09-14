/**
 * ErrorStateCard — displays agent-level errors with retry progress and action buttons.
 *
 * Shown when the agent execution ended with a fatal error (network drop,
 * timeout, unrecoverable failure). Distinct from per-tool-call errors which
 * are shown inline in ToolStep. The run is already over, so the card offers
 * "Dismiss" rather than "Cancel": cancelling a finished run would re-seal it
 * as stopped by the user.
 *
 * Variants (icon only; the caller passes the localised message):
 * - reconnecting: connection-type failure, with the retries already spent
 * - timeout: the run timed out
 * - error: any other failure
 *
 * @module timeline/ErrorStateCard
 */

'use client';

import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import { nodeVariants, CSS_ANIMATIONS } from './animations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorCardVariant = 'reconnecting' | 'timeout' | 'error';

interface ErrorStateCardProps {
  variant: ErrorCardVariant;
  /** Localised error message. */
  message: string;
  /** Current retry attempt number (1-based). */
  retryCount?: number;
  /** Maximum retry attempts allowed. */
  maxRetries?: number;
  /** Called when user clicks "Retry" button. */
  onRetry?: () => void;
  /** Called when user clicks "Dismiss": clears the finished run's error. */
  onDismiss?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ReconnectingIcon: React.FC = () => (
  <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center" aria-hidden="true">
    <svg
      className={`w-5 h-5 text-amber-500 dark:text-amber-400 ${CSS_ANIMATIONS.spin}`}
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
  </div>
);

const TimeoutIcon: React.FC = () => (
  <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center" aria-hidden="true">
    <svg className="w-5 h-5 text-amber-500 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  </div>
);

const ErrorIcon: React.FC = () => (
  <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center" aria-hidden="true">
    <svg className="w-5 h-5 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ErrorStateCard: React.FC<ErrorStateCardProps> = ({
  variant,
  message,
  retryCount = 0,
  maxRetries = 2,
  onRetry,
  onDismiss,
}) => {
  const { t } = useLocale();
  const handleRetry = useCallback(() => onRetry?.(), [onRetry]);
  const handleDismiss = useCallback(() => onDismiss?.(), [onDismiss]);

  const borderColor =
    variant === 'error'
      ? 'border-red-200 dark:border-red-800/50'
      : 'border-amber-200 dark:border-amber-800/50';

  const bgColor =
    variant === 'error'
      ? 'bg-red-50 dark:bg-red-900/10'
      : 'bg-amber-50 dark:bg-amber-900/10';

  const retriesUsed = t.agentTimeline.retriesUsed
    .replace('{n}', String(retryCount))
    .replace('{max}', String(maxRetries));

  return (
    <motion.div
      className={`rounded-lg border ${borderColor} ${bgColor} p-4`}
      variants={nodeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        {variant === 'reconnecting' && <ReconnectingIcon />}
        {variant === 'timeout' && <TimeoutIcon />}
        {variant === 'error' && <ErrorIcon />}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p role="alert" className="text-sm text-foreground dark:text-zinc-200 mb-2 leading-relaxed">
            {message}
          </p>

          {/* Retries already spent (for connection failures). Screen readers
              get the sentence; the digits and the bar are visual only (an
              aria-label on a plain span is not announced). */}
          {variant === 'reconnecting' && retryCount > 0 && (
            <div className="flex items-center gap-2 mb-2" title={retriesUsed}>
              <span className="sr-only">{retriesUsed}</span>
              <span className="text-xs text-muted-foreground dark:text-zinc-500 tabular-nums" aria-hidden="true">
                {retryCount}/{maxRetries}
              </span>
              {/* Progress bar */}
              <div className="flex-1 h-1 bg-border dark:bg-zinc-700 rounded-full overflow-hidden max-w-[120px]" aria-hidden="true">
                <div
                  className="h-full bg-amber-400 dark:bg-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((retryCount / maxRetries) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {onDismiss && (
              <button
                type="button"
                onClick={handleDismiss}
                className="text-xs text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-zinc-200 transition-colors px-3 py-1.5 rounded-md border border-border dark:border-zinc-600 hover:bg-accent dark:hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.agentTimeline.dismiss}
              </button>
            )}
            {onRetry && variant !== 'reconnecting' && (
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs text-primary hover:text-primary/80 transition-colors px-3 py-1.5 rounded-md bg-primary/10 dark:bg-primary/15 hover:bg-primary/20 dark:hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.agentTimeline.retry}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default ErrorStateCard;
