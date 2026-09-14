/**
 * ME-08: a 5xx retry used to resend the payload captured before the failure,
 * overwriting a newer save made in the meantime (observed order v1 → v2 → v1).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { updateVideoProject } from '@/lib/api/videoProjects';
import type { VideoEditingTaskContent } from '@/types';
import { useProjectAutosave, type UseProjectAutosaveOptions } from '../useProjectAutosave';

vi.mock('@/lib/api/videoProjects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/videoProjects')>();
  return { ...actual, updateVideoProject: vi.fn(async (id: string) => ({ id })) };
});

const updateMock = vi.mocked(updateVideoProject);

function content(version: string): VideoEditingTaskContent {
  return { markdownContent: version, lastModified: new Date('2026-09-14T00:00:00.000Z') };
}

function savedVersions(): string[] {
  return updateMock.mock.calls.map(([, input]) =>
    String((input as { project_data: { markdownContent: string } }).project_data.markdownContent));
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

interface Props { projectId: string; content: VideoEditingTaskContent; opts?: UseProjectAutosaveOptions }

function renderAutosave(initial: Props) {
  return renderHook((props: Props) => useProjectAutosave(props.projectId, props.content, props.opts), {
    initialProps: initial,
  });
}

beforeEach(() => {
  updateMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useProjectAutosave 5xx retry', () => {
  it('a 5xx retry never overwrites a newer save made after unmount', async () => {
    const { rerender, unmount } = renderAutosave({ projectId: 'p1', content: content('v0') });
    await advance(10);

    updateMock.mockRejectedValueOnce({ status: 503 });
    rerender({ projectId: 'p1', content: content('v1') });
    await advance(800);
    rerender({ projectId: 'p1', content: content('v2') });
    unmount();
    await advance(3000);

    expect(savedVersions()).toEqual(['v1', 'v2']);
  });

  it('a retry after a project switch does not save the old project', async () => {
    const onSaveError = vi.fn();
    const { rerender } = renderAutosave({ projectId: 'p1', content: content('a0'), opts: { onSaveError } });
    await advance(10);

    updateMock.mockRejectedValueOnce({ status: 503 });
    rerender({ projectId: 'p1', content: content('a1'), opts: { onSaveError } });
    await advance(800);
    rerender({ projectId: 'p2', content: content('b0'), opts: { onSaveError } });
    await advance(3000);

    expect(updateMock.mock.calls.map(([id]) => id)).toEqual(['p1']);
    expect(onSaveError).toHaveBeenCalledTimes(1);
  });

  it('a retry while still mounted saves the latest content', async () => {
    const onSaveSuccess = vi.fn();
    const { rerender } = renderAutosave({ projectId: 'p1', content: content('v0'), opts: { onSaveSuccess } });
    await advance(10);

    updateMock.mockRejectedValueOnce({ status: 502 });
    rerender({ projectId: 'p1', content: content('v1'), opts: { onSaveSuccess } });
    await advance(800);
    rerender({ projectId: 'p1', content: content('v2'), opts: { onSaveSuccess } });
    await advance(3000);

    expect(savedVersions()).toEqual(['v1', 'v2']);
    expect(onSaveSuccess).toHaveBeenCalled();
  });
});
