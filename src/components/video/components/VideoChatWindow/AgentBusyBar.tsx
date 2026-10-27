'use client';

/**
 * AgentBusyBar — narrow status strip rendered above the chat input while
 * the agent is executing. Shows a pulsing dot, what the agent is doing (plan
 * step "步骤 2/5 · 搜索素材" when a plan exists, else the tool / thinking
 * phase), the elapsed time, a "Enter to steer" hint, and a ghost Stop button
 * that mirrors the primary red stop button in the input send slot.
 *
 * Specs: docs/plans/agent-stop-and-resume/spec.md §2.5,
 *        docs/plans/agent-steering-and-skills/spec.md §3.4.1.
 *
 * Visibility is the caller's responsibility — render this component
 * conditionally on `agentIsExecuting` so the idle-state DOM is unchanged.
 *
 * Accessibility: only the status text is a live region. The ticking clock is
 * `aria-hidden`, otherwise a screen reader would announce it every second.
 *
 * @module AgentBusyBar
 */

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import type { ActiveStep } from '@/lib/video-editing-agent/planScan';

interface AgentBusyBarProps {
  executionState: AgentExecutionState | null;
  onCancel: () => void;
  /** Latest plan step of the running turn; absent → fall back to the phase label. */
  planStep?: ActiveStep | null;
  /** Show the "Enter to steer" hint (input empty and unfocused). */
  showSteerHint?: boolean;
}

/** `m:ss`; hours are not expected within the idle timeout but stay correct. */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function useElapsedSeconds(startTime: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startTime === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startTime]);
  return startTime === null ? 0 : (now - startTime) / 1_000;
}

const AgentBusyBar: React.FC<AgentBusyBarProps> = ({
  executionState, onCancel, planStep = null, showSteerHint = false,
}) => {
  const { t } = useLocale();
  const elapsed = useElapsedSeconds(executionState?.startTime ?? null);

  let label: string;
  if (executionState?.isThinking) {
    label = t.videoChatWindow.agentBusyThinking;
  } else if (planStep) {
    label = t.agentCollab.busyStep
      .replace('{index}', String(planStep.index))
      .replace('{total}', String(planStep.total))
      .replace('{title}', planStep.title);
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
      className="flex-shrink-0 flex items-center justify-between h-7 px-3 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-y border-amber-200 dark:border-amber-900"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <span role="status" aria-live="polite" className="truncate" title={label}>
          {label}
        </span>
        {executionState?.startTime != null ? (
          <span aria-hidden="true" data-testid="agent-busy-elapsed"
            className="shrink-0 tabular-nums text-amber-700/80 dark:text-amber-300/80">
            · {formatElapsed(elapsed)}
          </span>
        ) : null}
        {showSteerHint ? (
          <span aria-hidden="true" className="hidden shrink-0 text-amber-700/70 dark:text-amber-300/70 sm:inline">
            · {t.agentCollab.busyEnterHint}
          </span>
        ) : null}
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
