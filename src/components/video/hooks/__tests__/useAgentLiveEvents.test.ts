import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAgentLiveEvents } from '../useAgentLiveEvents';

describe('useAgentLiveEvents', () => {
  it('starts without a reading', () => {
    expect(renderHook(() => useAgentLiveEvents(false)).result.current.contextUsage).toBeNull();
  });

  it('keeps the latest context_usage; the last of a model call wins', () => {
    const { result } = renderHook(() => useAgentLiveEvents(true));

    act(() => {
      result.current.sinks.onContextUsage({
        type: 'context_usage', usedTokens: 10, windowTokens: 100, maxOutputTokens: 5, dropped: false });
      result.current.sinks.onContextUsage({
        type: 'context_usage', usedTokens: 40, windowTokens: 100, maxOutputTokens: 5, dropped: true });
    });

    expect(result.current.contextUsage).toEqual(
      { usedTokens: 40, windowTokens: 100, maxOutputTokens: 5, dropped: true });
  });

  it('routes crew and batch events into the crew state', () => {
    const { result } = renderHook(() => useAgentLiveEvents(true));

    act(() => {
      result.current.sinks.onCrewEvent({
        type: 'crew_start', toolCallId: 'tc', crewId: 'c', modelTier: 'fast', members: [{ id: 'a', goal: 'g' }] });
      result.current.sinks.onToolProgress({
        type: 'tool_progress', toolCallId: 'tc2', done: 1, total: 2, itemIndex: 0, status: 'ready' });
    });

    expect(Object.keys(result.current.crew.crews)).toEqual(['tc']);
    expect(result.current.crew.acquire.tc2.done).toBe(1);
  });

  it('hands out the same sinks on every render so the event router config stays stable', () => {
    const { result, rerender } = renderHook(({ active }) => useAgentLiveEvents(active),
      { initialProps: { active: true } });
    const first = result.current.sinks;

    act(() => result.current.sinks.onContextUsage({
      type: 'context_usage', usedTokens: 1, windowTokens: 2, maxOutputTokens: 1, dropped: false }));
    rerender({ active: false });

    expect(result.current.sinks).toBe(first);
  });

  it('seals a running crew when the turn ends', () => {
    const { result, rerender } = renderHook(({ active }) => useAgentLiveEvents(active),
      { initialProps: { active: true } });
    act(() => result.current.sinks.onCrewEvent({
      type: 'crew_start', toolCallId: 'tc', crewId: 'c', modelTier: 'fast', members: [{ id: 'a', goal: 'g' }] }));

    rerender({ active: false });

    expect(result.current.crew.crews.tc.members[0].state).toBe('cancelled');
  });
});
