import { describe, expect, it } from 'vitest';
import {
  EMPTY_LIVE_PROGRESS, hasRunningCrew, reduceLiveProgress,
  type LiveProgressAction, type LiveProgressState,
} from '../agentLiveProgress';

const START: LiveProgressAction = {
  type: 'crew_start', toolCallId: 'tc-1', crewId: 'crew-1', modelTier: 'fast',
  members: [{ id: 'shot-1', goal: 'night city' }, { id: 'shot-2', goal: 'latte art' }],
};
const member = (patch: object): LiveProgressAction => ({
  type: 'crew_member', crewId: 'crew-1', memberId: 'shot-1', state: 'running',
  toolCalls: 1, modelCalls: 1, elapsedMs: 100, ...patch,
} as LiveProgressAction);

const fold = (...actions: LiveProgressAction[]): LiveProgressState =>
  actions.reduce(reduceLiveProgress, EMPTY_LIVE_PROGRESS);

describe('reduceLiveProgress — research crew', () => {
  it('crew_start creates one queued row per member under the tool call id', () => {
    const state = fold(START);

    expect(state.crews['tc-1'].members.map(m => [m.id, m.state, m.goal]))
      .toEqual([['shot-1', 'queued', 'night city'], ['shot-2', 'queued', 'latte art']]);
    expect(state.crews['tc-1'].modelTier).toBe('fast');
  });

  it('crew_member updates only its own row, by crew id', () => {
    const state = fold(START, member({ activity: 'search:city night', toolCalls: 3 }));

    const [first, second] = state.crews['tc-1'].members;
    expect(first).toMatchObject({ state: 'running', activity: 'search:city night', toolCalls: 3 });
    expect(second.state).toBe('queued');
  });

  it('ignores a member event of a crew it never saw start', () => {
    expect(fold(member({}))).toBe(EMPTY_LIVE_PROGRESS);
  });

  it('crew_end marks the run ended', () => {
    const state = fold(START, { type: 'crew_end', crewId: 'crew-1', ready: 2, failed: 0, candidates: 4 });

    expect(state.crews['tc-1'].ended).toBe(true);
    expect(hasRunningCrew(state)).toBe(false);
  });

  it('seal turns members that never reported back into cancelled, keeps finished ones', () => {
    const state = fold(START, member({ state: 'done' }), { type: 'seal' });

    expect(state.crews['tc-1'].members.map(m => m.state)).toEqual(['done', 'cancelled']);
    expect(state.crews['tc-1'].ended).toBe(true);
  });

  it('seal returns the same state when nothing was running', () => {
    const state = fold(START, member({ state: 'done' }), member({ memberId: 'shot-2', state: 'failed' }));

    expect(reduceLiveProgress(state, { type: 'seal' })).toBe(state);
  });

  it('reports a crew as running only while a member is queued or running', () => {
    expect(hasRunningCrew(fold(START))).toBe(true);
    expect(hasRunningCrew(fold(START, { type: 'seal' }))).toBe(false);
  });

  it('keeps only the most recent crews', () => {
    const many = Array.from({ length: 15 }, (_, index): LiveProgressAction => ({
      ...(START as object), toolCallId: `tc-${index}`, crewId: `crew-${index}`,
    } as LiveProgressAction));

    const keys = Object.keys(fold(...many).crews);

    expect(keys).toHaveLength(12);
    expect(keys).toContain('tc-14');
    expect(keys).not.toContain('tc-0');
  });
});

describe('reduceLiveProgress — batch acquisition', () => {
  const progress = (patch: object): LiveProgressAction => ({
    type: 'tool_progress', toolCallId: 'tc-9', done: 1, total: 6, itemIndex: 0, status: 'ready', ...patch,
  } as LiveProgressAction);

  it('records the status of each settled slot', () => {
    const state = fold(progress({}), progress({ done: 2, itemIndex: 3, status: 'failed' }));

    expect(state.acquire['tc-9']).toEqual({ done: 2, total: 6, slots: { 0: 'ready', 3: 'failed' } });
  });

  it('never moves the done counter backwards when events arrive out of order', () => {
    const state = fold(progress({ done: 4, itemIndex: 2 }), progress({ done: 3, itemIndex: 1 }));

    expect(state.acquire['tc-9'].done).toBe(4);
  });
});
