import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { sendSteer } from '@/lib/api/agentSteer';
import {
  SteeringMachine, type SteeringHost, type SteeringNotice, type SteeringSnapshot,
  type SubmitResult, type TurnEnd,
} from './steeringMachine';
import type { SteerNote } from '@/types/agentSteering';

/**
 * 运行中插话/排队：React 侧的薄封装。状态机本身在 `steeringMachine.ts`。
 *
 * `useAgentExecution` 只负责把 SSE 事件转交给这里，不内嵌状态机，
 * 以满足 CLAUDE.md 的「函数 ≤ 50 行 / 文件 ≤ 800 行」。
 */

export interface UseAgentSteeringParams {
  persistApplied: (notes: SteerNote[]) => void;
  sendFollowUp: (text: string) => void;
  restoreDraft: (text: string) => void;
  notify: (notice: SteeringNotice) => void;
  cancelTurn: () => void;
}

export interface UseAgentSteeringReturn extends SteeringSnapshot {
  submit: (text: string, mode: 'steer' | 'queue') => SubmitResult;
  cancelNote: (id: string) => boolean;
  promoteToStop: (id: string) => void;
  startTurn: () => void;
  onRunStarted: (runId: string) => void;
  onRestart: () => void;
  onSteerApplied: (event: { steerId: string; afterToolCallId: string | null }) => void;
  onSteerDropped: (event: { steerIds: readonly string[] }) => void;
  onTurnEnd: (end: TurnEnd) => void;
}

function newSteerId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function useAgentSteering(params: UseAgentSteeringParams): UseAgentSteeringReturn {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const machine = useMemo(() => {
    // Delegates through the ref so the machine always calls the latest closures.
    const host: SteeringHost = {
      postSteer: request => sendSteer(request),
      persistApplied: notes => paramsRef.current.persistApplied(notes),
      sendFollowUp: text => paramsRef.current.sendFollowUp(text),
      restoreDraft: text => paramsRef.current.restoreDraft(text),
      notify: notice => paramsRef.current.notify(notice),
      cancelTurn: () => paramsRef.current.cancelTurn(),
      newId: newSteerId,
      now: () => Date.now(),
    };
    return new SteeringMachine(host);
  }, []);

  const snapshot = useSyncExternalStore(
    useCallback(listener => machine.subscribe(listener), [machine]),
    () => machine.getSnapshot(),
    () => machine.getSnapshot(),
  );

  // Stable identities: callers put these in dependency arrays.
  const actions = useMemo(() => ({
    submit: (text: string, mode: 'steer' | 'queue') => machine.submit(text, mode),
    cancelNote: (id: string) => machine.cancelNote(id),
    promoteToStop: (id: string) => machine.promoteToStop(id),
    startTurn: () => machine.startTurn(),
    onRunStarted: (runId: string) => machine.onRunStarted(runId),
    onRestart: () => machine.onRestart(),
    onSteerApplied: (event: { steerId: string; afterToolCallId: string | null }) =>
      machine.onSteerApplied(event),
    onSteerDropped: (event: { steerIds: readonly string[] }) => machine.onSteerDropped(event),
    onTurnEnd: (end: TurnEnd) => machine.onTurnEnd(end),
  }), [machine]);

  return { ...snapshot, ...actions };
}
