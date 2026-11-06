/**
 * Integration test for the timeline persistence loop:
 *
 *   hydrateTimelineFromProjectData → useTimelineStore → useProjectAutosave
 *
 * The plan (phase2-development-plan-revised.md §C.3 T6) calls for a closed
 * loop driven directly off the store + the autosave hook, NOT a render of
 * the full TimelinePanel. Rendering the panel pulls in jsdom-incompatible
 * surface (ResizeObserver, video element capabilities) without exercising
 * additional persistence behaviour.
 *
 * Cases:
 *   1. Persist → restore loop: hydrate, mutate, autosave PUTs new payload,
 *      remount with returned payload, store contains the new mutation.
 *   2. A → B → A: B's content does not pollute A's store on switch back.
 *   3. Schema-drift fallback: malformed payload yields a console.warn and
 *      empty tracks (no throw).
 *   4. Race: hydrate of project B starts before A's autosave finishes;
 *      A's payload must not overwrite B's data after the project switch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';

import { useTimelineStore } from '@/components/video/timeline/store';
import { hydrateTimelineFromProjectData } from '../hydrateTimeline';
import { useProjectAutosave } from '../hooks/useProjectAutosave';
import { updateVideoProject } from '@/lib/api/videoProjects';
import type { VideoEditingTaskContent } from '@/types';
import { createConversation } from '../../hooks/videoChatSessionModel';
import { useVideoChatContentBridge } from '../../hooks/useVideoChatContentBridge';
import { useVideoChatSessions } from '../../hooks/useVideoChatSessions';

// `useProjectAutosave` calls `updateVideoProject` from `@/lib/api/videoProjects`.
// We capture every call so each test can assert PUT timing/payload.
vi.mock('@/lib/api/videoProjects', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/videoProjects')>();
  return {
    ...actual,
    updateVideoProject: vi.fn(async (id: string) => ({ id })),
  };
});

const updateMock = vi.mocked(updateVideoProject);

function makeTrack(id: string, items: unknown[] = []) {
  const type: 'audio' | 'subtitle' | 'video' = id.startsWith('audio')
    ? 'audio'
    : id.startsWith('subtitle')
      ? 'subtitle'
      : 'video';
  return {
    id,
    name: id,
    type,
    height: 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items,
  };
}

function makeItem(id: string, startTime: number, duration: number, trackId: string) {
  return {
    id,
    name: id,
    type: 'video' as const,
    startTime,
    duration,
    trackId,
    color: '#4A90D9',
    volume: 1,
    opacity: 1,
  };
}

function makeContentWithTimeline(tracks: unknown[]): VideoEditingTaskContent {
  return {
    markdownContent: '',
    lastModified: new Date('2026-04-29T00:00:00Z'),
    uiState: {
      currentTimelineState: {
        currentTime: 0,
        totalDuration: 0,
        zoomLevel: 1,
        playbackRate: 1,
        isPlaying: false,
        snapToGrid: true,
        gridSize: 0.5,
        scrollLeft: 0,
        tracks,
      },
    },
  } as unknown as VideoEditingTaskContent;
}

beforeEach(() => {
  updateMock.mockClear();
  // Reset the timeline store between tests.
  useTimelineStore.getState().importFromData({
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
    tracks: [],
  });
  useTimelineStore.getState().clearHistory();
  useTimelineStore.getState().deselectAll();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('persistence loop', () => {
  it.each([
    { label: '自动重试', status: 503, manual: false },
    { label: '手动重试', status: 409, manual: true },
  ])('两会话保存失败不回滚内存，$label 提交最新标题和活动页签', async ({ status, manual }) => {
    const baseline = { ...makeContentWithTimeline([]),
      conversations: [createConversation('a', '方案')], activeConversationId: 'a' };
    const failure = Object.assign(new Error('保存失败'), { status });
    updateMock.mockRejectedValueOnce(failure);
    const onSaveError = vi.fn();
    const onSaveSuccess = vi.fn();
    const { result } = renderHook(() => {
      const [content, setContent] = useState<VideoEditingTaskContent>(baseline);
      const bridge = useVideoChatContentBridge({ projectKey: 'chat-project',
        content, onUpdateContent: setContent });
      const sessions = useVideoChatSessions({ projectKey: 'chat-project',
        contentBridge: bridge, isConversationReady: true,
        getBusyReason: () => null, labels: { defaultTitle: '新会话 {n}' } });
      const autosave = useProjectAutosave('chat-project', content,
        { onSaveError, onSaveSuccess });
      return { content, sessions, autosave };
    });

    act(() => { expect(result.current.sessions.createConversation().ok).toBe(true); });
    const secondId = result.current.sessions.activeConversationId!;
    const unsavedContent = result.current.content;
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(result.current.content).toBe(unsavedContent);
    expect(result.current.sessions.conversations.map(item => item.id)).toEqual(['a', secondId]);
    expect(result.current.sessions.activeConversationId).toBe(secondId);
    if (manual) expect(onSaveError).toHaveBeenCalledWith(failure);
    else expect(onSaveError).not.toHaveBeenCalled();

    act(() => { expect(result.current.sessions.renameConversation(secondId, '最新剪辑方案').ok).toBe(true); });
    act(() => { expect(result.current.sessions.selectConversation('a').ok).toBe(true); });
    const latestContent = result.current.content;
    await act(async () => {
      if (manual) result.current.autosave.retryNow();
      else await vi.advanceTimersByTimeAsync(3000);
    });
    expect(updateMock).toHaveBeenCalledTimes(2);
    const [projectId, retry] = updateMock.mock.calls[1];
    expect(projectId).toBe('chat-project');
    expect(retry.project_data?.conversations).toEqual(latestContent.conversations);
    expect(retry.project_data?.activeConversationId).toBe('a');
    expect(result.current.content).toBe(latestContent);
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(updateMock).toHaveBeenCalledTimes(2);
  });

  it('两会话按顺序保存并恢复，删除后只提交剩余会话', async () => {
    const baseline = makeContentWithTimeline([]);
    const { rerender } = renderHook(({ content }) =>
      useProjectAutosave('chat-project', content), {
      initialProps: { content: baseline },
    });
    const a = createConversation('a', '方案');
    const b = createConversation('b', '剪辑');
    const edited = { ...baseline, conversations: [a, b], activeConversationId: 'b' };
    rerender({ content: edited });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    const saved = JSON.parse(JSON.stringify(updateMock.mock.calls[0][1].project_data));
    expect(saved.conversations.map((item: { id: string }) => item.id)).toEqual(['a', 'b']);
    expect(saved.activeConversationId).toBe('b');
    rerender({ content: { ...edited, conversations: [b] } });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    const final = updateMock.mock.calls[updateMock.mock.calls.length - 1][1].project_data;
    expect(final?.conversations).toEqual([b]);
  });
  it('does NOT PUT immediately after hydrating an existing project (baseline init)', async () => {
    const tracks = [makeTrack('video-track-1', [makeItem('it-a', 0, 5, 'video-track-1')])];
    hydrateTimelineFromProjectData({
      uiState: { currentTimelineState: { tracks } as unknown as Record<string, unknown> },
    });
    const initialContent = makeContentWithTimeline(tracks);

    renderHook(() => useProjectAutosave('proj-A', initialContent));

    // Push past the idle debounce + max-flush. With baseline init in place,
    // no PUT should fire — the rehydrated content is treated as the saved
    // baseline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('PUTs the latest payload after a real edit (still after baseline init)', async () => {
    const baselineTracks = [makeTrack('video-track-1', [])];
    hydrateTimelineFromProjectData({
      uiState: { currentTimelineState: { tracks: baselineTracks } as unknown as Record<string, unknown> },
    });
    const baseline = makeContentWithTimeline(baselineTracks);

    const { rerender } = renderHook(
      ({ content }: { content: VideoEditingTaskContent }) =>
        useProjectAutosave('proj-A', content),
      { initialProps: { content: baseline } },
    );

    // Allow baseline init to take effect.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(updateMock).not.toHaveBeenCalled();

    const editedTracks = [makeTrack('video-track-1', [makeItem('new-item', 0, 4, 'video-track-1')])];
    rerender({ content: makeContentWithTimeline(editedTracks) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, input] = updateMock.mock.calls[0];
    const projectData = (input as { project_data: Record<string, unknown> }).project_data;
    const persistedTracks = (
      (projectData.uiState as Record<string, unknown>).currentTimelineState as {
        tracks: { items: { id: string }[] }[];
      }
    ).tracks;
    expect(persistedTracks[0].items[0].id).toBe('new-item');
  });

  it('A → B → A: A is not overwritten by B', async () => {
    const aTracks = [makeTrack('video-track-1', [makeItem('a-item', 0, 5, 'video-track-1')])];
    const bTracks = [makeTrack('video-track-1', [makeItem('b-item', 0, 5, 'video-track-1')])];

    // Open A.
    hydrateTimelineFromProjectData({
      uiState: { currentTimelineState: { tracks: aTracks } as unknown as Record<string, unknown> },
    });
    expect(useTimelineStore.getState().tracks[0].items[0].id).toBe('a-item');

    // Switch to B.
    hydrateTimelineFromProjectData({
      uiState: { currentTimelineState: { tracks: bTracks } as unknown as Record<string, unknown> },
    });
    expect(useTimelineStore.getState().tracks[0].items[0].id).toBe('b-item');

    // Switch back to A. The store must reflect A again.
    hydrateTimelineFromProjectData({
      uiState: { currentTimelineState: { tracks: aTracks } as unknown as Record<string, unknown> },
    });
    expect(useTimelineStore.getState().tracks[0].items[0].id).toBe('a-item');
  });

  it('schema-drift fallback: malformed tracks → empty store, console.warn fires', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    hydrateTimelineFromProjectData({
      uiState: { currentTimelineState: { tracks: 'oops' as unknown as unknown[] } },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(useTimelineStore.getState().tracks.length).toBe(0);
  });

  it('autosave correctly resets baseline on project switch (no skip-equal leak)', async () => {
    const aTracks = [makeTrack('video-track-1', [makeItem('a-item', 0, 5, 'video-track-1')])];
    const bTracks = [makeTrack('video-track-1', [makeItem('b-item', 0, 5, 'video-track-1')])];
    const aContent = makeContentWithTimeline(aTracks);
    const bContent = makeContentWithTimeline(bTracks);

    const { rerender } = renderHook(
      ({ projectId, content }: { projectId: string; content: VideoEditingTaskContent }) =>
        useProjectAutosave(projectId, content),
      { initialProps: { projectId: 'proj-A', content: aContent } },
    );

    // Baseline-init for A; no PUT.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(updateMock).not.toHaveBeenCalled();

    // Switch project — baseline must reset so B's first content frame
    // becomes the new baseline (still no PUT). If the baseline reset were
    // missing, autosave would think B's content is a diff from A's saved
    // payload and PUT it on the wrong projectId.
    rerender({ projectId: 'proj-B', content: bContent });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(updateMock).not.toHaveBeenCalled();

    // A real edit on B then PUTs against project B (not A).
    const bEdited = makeContentWithTimeline([
      makeTrack('video-track-1', [makeItem('b-item', 0, 5, 'video-track-1'), makeItem('b-item-2', 5, 3, 'video-track-1')]),
    ]);
    rerender({ projectId: 'proj-B', content: bEdited });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toBe('proj-B');
  });
});
