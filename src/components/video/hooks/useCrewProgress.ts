import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { CrewLiveEvent } from '@/lib/video-editing-agent/AgentEventRouter';
import {
  EMPTY_LIVE_PROGRESS, hasRunningCrew, reduceLiveProgress,
  type LiveAcquire, type LiveCrew, type LiveProgressState, type ToolProgressEvent,
} from './agentLiveProgress';

/**
 * Running snapshots of research-crew runs and batch material acquisitions,
 * keyed by the tool call that started them. React state only: a finished card
 * is rebuilt from the persisted `tool_result`, so nothing here is saved.
 */

export interface UseCrewProgressReturn {
  crews: Readonly<Record<string, LiveCrew>>;
  acquire: Readonly<Record<string, LiveAcquire>>;
  /** A crew is mid-run (drives the "delivered when the crew finishes" hint). */
  isCrewRunning: boolean;
  onCrewEvent: (event: CrewLiveEvent) => void;
  onToolProgress: (event: ToolProgressEvent) => void;
}

/**
 * @param isTurnActive Whether the agent turn is running. Its falling edge
 *   seals members that never reported back (turn stopped or errored) as
 *   `cancelled`, so no card keeps spinning after the turn is over.
 */
export function useCrewProgress(isTurnActive: boolean): UseCrewProgressReturn {
  const [state, dispatch] = useReducer(reduceLiveProgress, EMPTY_LIVE_PROGRESS);
  const wasActive = useRef(isTurnActive);

  useEffect(() => {
    if (wasActive.current && !isTurnActive) dispatch({ type: 'seal' });
    wasActive.current = isTurnActive;
  }, [isTurnActive]);

  const onCrewEvent = useCallback((event: CrewLiveEvent) => dispatch(event), []);
  const onToolProgress = useCallback((event: ToolProgressEvent) => dispatch(event), []);

  return useMemo(() => ({
    crews: state.crews,
    acquire: state.acquire,
    isCrewRunning: isTurnActive && hasRunningCrew(state),
    onCrewEvent,
    onToolProgress,
  }), [state, isTurnActive, onCrewEvent, onToolProgress]);
}

/** What the timeline cards read; supplied once by `VideoChatWindow`. */
export type LiveProgressView = Pick<LiveProgressState, 'crews' | 'acquire'>;

export const LiveProgressContext = createContext<LiveProgressView>(EMPTY_LIVE_PROGRESS);

export function useLiveProgress(): LiveProgressView {
  return useContext(LiveProgressContext);
}
