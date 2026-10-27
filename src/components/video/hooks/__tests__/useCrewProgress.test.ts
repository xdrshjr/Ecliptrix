import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CrewLiveEvent } from '@/lib/video-editing-agent/AgentEventRouter';
import { useCrewProgress } from '../useCrewProgress';

const START: CrewLiveEvent = {
  type: 'crew_start', toolCallId: 'tc-1', crewId: 'crew-1', modelTier: 'main',
  members: [{ id: 'a', goal: 'g' }],
};

describe('useCrewProgress', () => {
  it('aggregates crew and progress events by tool call id', () => {
    const { result } = renderHook(() => useCrewProgress(true));

    act(() => {
      result.current.onCrewEvent(START);
      result.current.onToolProgress({
        type: 'tool_progress', toolCallId: 'tc-2', done: 1, total: 2, itemIndex: 0, status: 'ready',
      });
    });

    expect(result.current.crews['tc-1'].members).toHaveLength(1);
    expect(result.current.acquire['tc-2'].done).toBe(1);
    expect(result.current.isCrewRunning).toBe(true);
  });

  it('seals running members as cancelled when the turn stops', () => {
    const { result, rerender } = renderHook(({ active }) => useCrewProgress(active),
      { initialProps: { active: true } });
    act(() => result.current.onCrewEvent(START));

    rerender({ active: false });

    expect(result.current.crews['tc-1'].members[0].state).toBe('cancelled');
    expect(result.current.isCrewRunning).toBe(false);
  });

  it('does not seal while the turn is still running', () => {
    const { result, rerender } = renderHook(({ active }) => useCrewProgress(active),
      { initialProps: { active: true } });
    act(() => result.current.onCrewEvent(START));

    rerender({ active: true });

    expect(result.current.crews['tc-1'].members[0].state).toBe('queued');
  });

  it('keeps stable callbacks so they can sit in the event router config', () => {
    const { result, rerender } = renderHook(({ active }) => useCrewProgress(active),
      { initialProps: { active: true } });
    const { onCrewEvent, onToolProgress } = result.current;

    rerender({ active: false });

    expect(result.current.onCrewEvent).toBe(onCrewEvent);
    expect(result.current.onToolProgress).toBe(onToolProgress);
  });
});
