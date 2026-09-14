/**
 * ME-08: the desktop close guard flushes registered autosaves before the
 * window closes. The flush must include edits still inside the debounce and
 * must not be starved by a 5xx retry back-off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { updateVideoProject } from '@/lib/api/videoProjects';
import type { VideoEditingTaskContent } from '@/types';
import { flushAllPending, type FlushAllResult } from '../../autosaveRegistry';
import { useProjectAutosave } from '../useProjectAutosave';

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

async function flushForClose(): Promise<FlushAllResult> {
  let result: FlushAllResult | undefined;
  await act(async () => {
    result = await flushAllPending(2500);
  });
  return result as FlushAllResult;
}

function renderAutosave(initial: VideoEditingTaskContent) {
  return renderHook(({ value }: { value: VideoEditingTaskContent }) => useProjectAutosave('p1', value), {
    initialProps: { value: initial },
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

describe('useProjectAutosave close flush', () => {
  it('saves an edit still inside the debounce window', async () => {
    const { rerender, unmount } = renderAutosave(content('v0'));
    await advance(10);
    rerender({ value: content('v1') });

    const result = await flushForClose();

    expect(savedVersions()).toEqual(['v1']);
    expect(result).toEqual({ ok: true, failedKeys: [], timedOut: false });
    unmount();
  });

  it('the registered flush waits for the in-flight save then saves the latest content', async () => {
    let finishFirstSave: () => void = () => {};
    updateMock.mockImplementationOnce(
      (id: string) => new Promise((resolve) => { finishFirstSave = () => resolve({ id } as never); }),
    );
    const { rerender, unmount } = renderAutosave(content('v0'));
    await advance(10);
    rerender({ value: content('v1') });
    await advance(800);
    rerender({ value: content('v2') });

    const pending = flushAllPending(2500);
    finishFirstSave();
    let result: FlushAllResult | undefined;
    await act(async () => { result = await pending; });

    expect(savedVersions()).toEqual(['v1', 'v2']);
    expect(result?.ok).toBe(true);
    unmount();
  });

  it('the close flush skips the 5xx retry wait instead of consuming the close budget', async () => {
    const { rerender, unmount } = renderAutosave(content('v0'));
    await advance(10);
    updateMock.mockRejectedValueOnce({ status: 503 });
    rerender({ value: content('v1') });
    await advance(800);
    rerender({ value: content('v2') });

    const result = await flushForClose();

    expect(result).toEqual({ ok: true, failedKeys: [], timedOut: false });
    expect(savedVersions()).toEqual(['v1', 'v2']);
    unmount();
  });

  it('a close right after leaving the editor still waits for the unmount save', async () => {
    const { rerender, unmount } = renderAutosave(content('v0'));
    await advance(10);
    updateMock.mockRejectedValueOnce({ status: 503 });
    rerender({ value: content('v1') });
    await advance(800);
    rerender({ value: content('v2') });
    unmount();

    const result = await flushForClose();

    expect(savedVersions()).toEqual(['v1', 'v2']);
    expect(result).toEqual({ ok: true, failedKeys: [], timedOut: false });
    expect(await flushForClose()).toEqual({ ok: true, failedKeys: [], timedOut: false });
  });

  it('reports a failed close flush so the user can keep the window open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender, unmount } = renderAutosave(content('v0'));
    await advance(10);
    updateMock.mockRejectedValue({ status: 400 });
    rerender({ value: content('v1') });

    const result = await flushForClose();

    expect(result).toEqual({ ok: false, failedKeys: ['project:p1'], timedOut: false });
    updateMock.mockReset();
    updateMock.mockImplementation(async (id: string) => ({ id }) as never);
    unmount();
  });
});
