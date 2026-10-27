import { useCallback, useMemo, useState } from 'react';
import type { AgentEventRouterConfig } from '@/lib/video-editing-agent/AgentEventRouter';
import type { ContextUsageReading } from './contextUsage';
import { useCrewProgress, type UseCrewProgressReturn } from './useCrewProgress';

/**
 * Receiver for the transient SSE readings (`context_usage`, `tool_progress`,
 * `crew_*`). Lives next to `useAgentExecution`, which hands `sinks` to every
 * turn's event router; the state it keeps survives the chat dock being
 * minimised because the editor, not the chat window, owns it.
 */

export type AgentLiveSinks = Required<Pick<AgentEventRouterConfig,
  'onContextUsage' | 'onToolProgress' | 'onCrewEvent'>>;

export interface AgentLiveEvents {
  sinks: AgentLiveSinks;
  crew: UseCrewProgressReturn;
  /** Latest server reading of the prompt size; null before the first model call. */
  contextUsage: ContextUsageReading | null;
}

export function useAgentLiveEvents(isTurnActive: boolean): AgentLiveEvents {
  const crew = useCrewProgress(isTurnActive);
  const [contextUsage, setContextUsage] = useState<ContextUsageReading | null>(null);
  const { onCrewEvent, onToolProgress } = crew;

  const onContextUsage = useCallback<AgentLiveSinks['onContextUsage']>(event => {
    setContextUsage({
      usedTokens: event.usedTokens,
      windowTokens: event.windowTokens,
      maxOutputTokens: event.maxOutputTokens,
      dropped: event.dropped,
    });
  }, []);

  const sinks = useMemo<AgentLiveSinks>(
    () => ({ onContextUsage, onToolProgress, onCrewEvent }),
    [onContextUsage, onToolProgress, onCrewEvent],
  );
  return { sinks, crew, contextUsage };
}
