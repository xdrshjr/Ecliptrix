'use client';

import React, { useId, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { savedPercent } from '@/components/video/hooks/conversationCompaction';

/**
 * CompactionDivider — the rule in the timeline that marks where earlier turns
 * were folded into a digest. The folded messages stay above it (only the model
 * view is cut); "Undo" removes the digest and restores the previous behaviour.
 *
 * Spec: docs/plans/agent-research-crew-and-context-memory/spec.md §4.3.
 */

export interface CompactionDividerProps {
  /** Pending: the digest is still being made, show the skeleton in its place. */
  pending?: boolean;
  messageId?: string;
  summaryText?: string;
  coveredCount?: number;
  tokensBefore?: number;
  tokensAfter?: number;
  /** Undo is unavailable while a turn runs (its writes would overwrite it). */
  undoDisabled?: boolean;
  onUndo?: (messageId: string) => void;
}

const LINK_BUTTON = 'rounded px-1 text-primary underline underline-offset-2 '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary '
  + 'disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline';

// Over 50 lines: the pending and the finished layout share one expand state.
const CompactionDivider: React.FC<CompactionDividerProps> = ({
  pending = false, messageId, summaryText = '', coveredCount = 0,
  tokensBefore = 0, tokensAfter = 0, undoDisabled = false, onUndo,
}) => {
  const { t } = useLocale();
  const copy = t.agentContext;
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();

  if (pending) {
    return (
      <div role="status" className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="motion-safe:animate-pulse">{copy.compacting}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const text = copy.divider.replace('{n}', String(coveredCount))
    .replace('{pct}', String(savedPercent(tokensBefore, tokensAfter)));
  return (
    <div className="my-1 text-xs text-muted-foreground" data-testid="compaction-divider">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span className="shrink-0">{text}</span>
        <button type="button" aria-expanded={expanded} aria-controls={regionId}
          onClick={() => setExpanded(open => !open)} className={LINK_BUTTON}>
          {expanded ? copy.collapse : copy.expand}
        </button>
        <button type="button" disabled={undoDisabled || !messageId}
          onClick={() => messageId && onUndo?.(messageId)} className={LINK_BUTTON}>
          {copy.undo}
        </button>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      {expanded && (
        <div id={regionId} role="region" aria-label={copy.summaryLabel}
          className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-foreground">
          <MarkdownRenderer content={summaryText} />
        </div>
      )}
    </div>
  );
};

export default CompactionDivider;
