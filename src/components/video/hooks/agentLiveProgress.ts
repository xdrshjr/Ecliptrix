import type { CrewLiveEvent } from '@/lib/video-editing-agent/AgentEventRouter';
import type { CrewMemberState, SSEEvent } from '@/lib/video-editing-agent/types';

/**
 * Pure reducer behind `useCrewProgress`: folds the transient `crew_*` and
 * `tool_progress` SSE events into per-tool-call snapshots.
 *
 * These are readings, never the state source — the finished card is rebuilt
 * from `tool_result` — so a lost or replayed event only blurs a running card
 * and the next `crew_start` overwrites it.
 */

export type ToolProgressEvent = SSEEvent & { type: 'tool_progress' };
export type AcquireSlotStatus = ToolProgressEvent['status'];

export interface LiveCrewMember {
  id: string;
  goal: string;
  state: CrewMemberState;
  /** Sanitised by the server: a code such as `search:<query>`, never page text. */
  activity?: string;
  toolCalls: number;
  modelCalls: number;
  elapsedMs: number;
}

export interface LiveCrew {
  toolCallId: string;
  crewId: string;
  modelTier: 'fast' | 'main';
  members: LiveCrewMember[];
  ended: boolean;
}

export interface LiveAcquire {
  done: number;
  total: number;
  /** Settled slots by item index. */
  slots: Record<number, AcquireSlotStatus>;
}

export interface LiveProgressState {
  crews: Record<string, LiveCrew>;
  acquire: Record<string, LiveAcquire>;
}

export type LiveProgressAction =
  | CrewLiveEvent
  | ToolProgressEvent
  /** The turn ended: members that never reported back were stopped with it. */
  | { type: 'seal' };

export const EMPTY_LIVE_PROGRESS: LiveProgressState = { crews: {}, acquire: {} };

/** One batch or crew per tool call; a few turns of history is all a card needs. */
const MAX_TRACKED = 12;

const isRunning = (state: CrewMemberState): boolean =>
  state === 'queued' || state === 'running';

function capEntries<T>(entries: Record<string, T>): Record<string, T> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_TRACKED) return entries;
  return Object.fromEntries(keys.slice(keys.length - MAX_TRACKED).map(key => [key, entries[key]]));
}

function findByCrewId(crews: Record<string, LiveCrew>, crewId: string): LiveCrew | undefined {
  return Object.values(crews).find(crew => crew.crewId === crewId);
}

function startCrew(state: LiveProgressState, event: CrewLiveEvent & { type: 'crew_start' }): LiveProgressState {
  const crew: LiveCrew = {
    toolCallId: event.toolCallId,
    crewId: event.crewId,
    modelTier: event.modelTier,
    ended: false,
    members: event.members.map(member => ({
      id: member.id, goal: member.goal, state: 'queued', toolCalls: 0, modelCalls: 0, elapsedMs: 0,
    })),
  };
  return { ...state, crews: capEntries({ ...state.crews, [event.toolCallId]: crew }) };
}

function updateMember(state: LiveProgressState, event: CrewLiveEvent & { type: 'crew_member' }): LiveProgressState {
  const crew = findByCrewId(state.crews, event.crewId);
  if (!crew) return state;
  const members = crew.members.map(member => member.id !== event.memberId ? member : {
    ...member,
    state: event.state,
    activity: event.activity,
    toolCalls: event.toolCalls,
    modelCalls: event.modelCalls,
    elapsedMs: event.elapsedMs,
  });
  return { ...state, crews: { ...state.crews, [crew.toolCallId]: { ...crew, members } } };
}

function endCrew(state: LiveProgressState, event: CrewLiveEvent & { type: 'crew_end' }): LiveProgressState {
  const crew = findByCrewId(state.crews, event.crewId);
  if (!crew) return state;
  return { ...state, crews: { ...state.crews, [crew.toolCallId]: { ...crew, ended: true } } };
}

function recordProgress(state: LiveProgressState, event: ToolProgressEvent): LiveProgressState {
  const previous = state.acquire[event.toolCallId];
  const next: LiveAcquire = {
    done: Math.max(previous?.done ?? 0, event.done),
    total: event.total,
    slots: { ...previous?.slots, [event.itemIndex]: event.status },
  };
  return { ...state, acquire: capEntries({ ...state.acquire, [event.toolCallId]: next }) };
}

function sealRunning(state: LiveProgressState): LiveProgressState {
  let changed = false;
  const crews: Record<string, LiveCrew> = {};
  for (const [key, crew] of Object.entries(state.crews)) {
    if (!crew.members.some(member => isRunning(member.state))) {
      crews[key] = crew;
      continue;
    }
    changed = true;
    crews[key] = {
      ...crew,
      ended: true,
      members: crew.members.map(member =>
        isRunning(member.state) ? { ...member, state: 'cancelled', activity: undefined } : member),
    };
  }
  return changed ? { ...state, crews } : state;
}

export function reduceLiveProgress(
  state: LiveProgressState, action: LiveProgressAction,
): LiveProgressState {
  switch (action.type) {
    case 'crew_start': return startCrew(state, action);
    case 'crew_member': return updateMember(state, action);
    case 'crew_end': return endCrew(state, action);
    case 'tool_progress': return recordProgress(state, action);
    case 'seal': return sealRunning(state);
  }
}

/** True while any crew still has a queued or running member. */
export function hasRunningCrew(state: LiveProgressState): boolean {
  return Object.values(state.crews).some(
    crew => !crew.ended && crew.members.some(member => isRunning(member.state)));
}
