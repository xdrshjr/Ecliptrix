/**
 * RV-09: the top bar's "save failed — retry now" must never start a second
 * PUT next to the one already queued or in flight.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { updateVideoProject } from '@/lib/api/videoProjects';
import type { VideoEditingTaskContent } from '@/types';
import { useProjectAutosave } from '../useProjectAutosave';

vi.mock('@/lib/api/videoProjects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/videoProjects')>();
  return { ...actual, updateVideoProject: vi.fn(async (id: string) => ({ id })) };
});

const updateMock = vi.mocked(updateVideoProject);

function content(version: string): VideoEditingTaskContent {
  return { markdownContent: version, lastModified: new Date('2026-09-23T00:00:00.000Z') };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

interface Props { content: VideoEditingTaskContent }

function renderAutosave(initial: Props) {
  return renderHook((props: Props) => useProjectAutosave('p1', props.content), { initialProps: initial });
}

beforeEach(() => {
  updateMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useProjectAutosave retryNow', () => {
  it('retry_now_during_backoff_does_not_double_put', async () => {
    const { result, rerender } = renderAutosave({ content: content('v0') });
    await advance(10);

    updateMock.mockRejectedValueOnce({ status: 503 });
    rerender({ content: content('v1') });
    await advance(800); // first PUT fails → 3 s back-off starts
    expect(updateMock).toHaveBeenCalledTimes(1);

    act(() => result.current.retryNow());
    await advance(10); // the queued retry runs now instead of after 3 s
    expect(updateMock).toHaveBeenCalledTimes(2);

    await advance(5000); // and nothing else fires when the old timer would have
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it('retry_now_while_in_flight_marks_dirty', async () => {
    let release: () => void = () => {};
    const { result, rerender } = renderAutosave({ content: content('v0') });
    await advance(10);

    updateMock.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ id: 'p1' } as Awaited<ReturnType<typeof updateVideoProject>>);
    }));
    rerender({ content: content('v1') });
    await advance(800); // PUT v1 in flight
    rerender({ content: content('v2') });
    act(() => result.current.retryNow());
    expect(updateMock).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    await advance(10); // the in-flight save re-runs once for the newer content
    expect(updateMock).toHaveBeenCalledTimes(2);
  });
});
