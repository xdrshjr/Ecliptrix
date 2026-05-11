'use client';

/**
 * AgentBusyBar — narrow status strip rendered above the chat input while
 * the agent is executing. Shows a pulsing dot + a short label describing
 * the current phase (thinking / running tool / generic working), plus a
 * secondary ghost Stop button that mirrors the primary red stop button in
 * the input send slot.
 *
 * Spec: docs/plans/agent-stop-and-resume/spec.md §2.5.
 *
 * Visibility is the caller's responsibility — render this component
 * conditionally on `agentIsExecuting` so the idle-state DOM is unchanged.
 *
 * @module AgentBusyBar
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';

interface AgentBusyBarProps {
  executionState: AgentExecutionState | null;
  onCancel: () => void;
}

const AgentBusyBar: React.FC<AgentBusyBarProps> = ({ executionState, onCancel }) => {
  const { t } = useLocale();

  let label: string;
  if (executionState?.isThinking) {
    label = t.videoChatWindow.agentBusyThinking;
  } else if (executionState?.currentTool) {
    label = t.videoChatWindow.agentBusyTool.replace(
      '{tool}',
      executionState.currentTool.name,
    );
  } else {
    label = t.videoChatWindow.agentBusyWorking;
  }

  return (
    <div
      data-testid="agent-busy-bar"
      role="status"
      aria-live="polite"
      className="flex-shrink-0 flex items-center justify-between h-[22px] px-3 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-y border-amber-200 dark:border-amber-900"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="relative inline-flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <span className="truncate" title={label}>
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="ml-2 shrink-0 text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 rounded"
        aria-label={t.videoChatWindow.stopAgentTooltip}
      >
        {t.videoChatWindow.stopButtonLabel}
      </button>
    </div>
  );
};

export default AgentBusyBar;
