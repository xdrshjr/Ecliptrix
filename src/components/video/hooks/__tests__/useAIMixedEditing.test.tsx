/**
 * useAIMixedEditing — AI auto edit orchestration (AM-01 / AM-07 / AM-08).
 *
 * The network (http-client), footage analysis and the two contexts are
 * mocked; the timeline store is real so undo history is exercised end to
 * end. Requests are driven by hand-resolved promises, never by sleeping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ApiError, TimeoutError } from '@/lib/api/http-client';
import { getTranslations } from '@/lib/i18n';
import type { MaterialItem, TimelineState } from '@/types';
import type { TimelineData, TrackData } from '../../timeline/domain';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import {
  AiMixImportError,
  mapAiMixError,
  toAiMixMaterialDtos,
  useAIMixedEditing,
} from '../useAIMixedEditing';
import type { UseAIMixedEditingOptions } from '../useAIMixedEditing';

const post = vi.fn();
const analyzeVideosInBatch = vi.fn();
const notify = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};

vi.mock('@/lib/api/http-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/http-client')>();
  return { ...actual, http: { post: (...args: unknown[]) => post(...args) } };
});

vi.mock('../../utils/parallelVideoAnalysis', () => ({
  VIDEO_ANALYSIS_CONFIG: { MAX_RETRY_ATTEMPTS: 0, RETRY_DELAY_MS: 0 },
  analyzeVideosInBatch: (...args: unknown[]) => analyzeVideosInBatch(...args),
}));

vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => notify,
}));

vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations: loadTranslations } = await import('@/lib/i18n');
  const t = loadTranslations('en');
  return { useLocale: () => ({ t, locale: 'en', setLocale: () => {} }) };
});

const en = getTranslations('en');
const QUICK = { type: 'quick' } as const;

const material: MaterialItem = {
  id: 'material-video',
  name: 'city.mp4',
  type: 'video',
  format: 'mp4',
  size: 1024,
  duration: 5,
  url: '/api/storage/files/video/city.mp4',
  createdAt: new Date('2026-09-13T08:00:00.000Z'),
};

function lane(
  id: string,
  name: string,
  type: TrackData['type'],
  items: TrackData['items'],
): TrackData {
  return {
    id,
    name,
    type,
    height: 60,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: 0,
    items,
  };
}

function timelineOf(tracks: TrackData[]): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 6,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
    tracks,
  };
}

const importedPlan: TimelineState = {
  ...timelineOf([lane('video-track-1', 'Video Track', 'video', [{
    id: 'ai-clip',
    name: 'AI clip',
    type: 'video',
    startTime: 0,
    duration: 6,
    trackId: 'video-track-1',
    color: '#3b82f6',
    materialId: 'material-video',
  }])]),
  selectedItems: [],
};

function seedTimeline(subtitleTrackName = 'Subtitles'): void {
  useTimelineStore.getState().initTimeline(timelineOf([
    lane('video-track-1', 'Video 1', 'video', [{
      id: 'user-clip',
      name: 'user clip',
      type: 'video',
      startTime: 0,
      duration: 4,
      trackId: 'video-track-1',
      color: '#3b82f6',
      materialId: 'material-video',
    }]),
    lane('subtitle-track-1', subtitleTrackName, 'subtitle', [{
      id: 'caption',
      name: 'caption',
      type: 'subtitle',
      startTime: 0,
      duration: 2,
      trackId: 'subtitle-track-1',
      color: '#6b7280',
      text: 'hello',
    }]),
  ]));
  useTimelineStore.getState().clearHistory();
}

function hookOptions(
  overrides: Partial<UseAIMixedEditingOptions> = {},
): UseAIMixedEditingOptions {
  return {
    taskId: 'task-1',
    getMaterials: () => [material],
    isAgentExecuting: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** A request that never answers on its own; it rejects once aborted. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
}

function respondWithPlan(): void {
  post.mockImplementation((path: string) => Promise.resolve(
    path === '/api/ai-mixed-editing'
      ? { success: true, timelineData: { metadata: { warnings: [] } } }
      : { success: true, importedData: { timelineState: importedPlan } },
  ));
}

const currentTimeline = () => useTimelineStore.getState().exportToData();

describe('useAIMixedEditing', () => {
  beforeEach(() => {
    seedTimeline();
    useTimelineStore.getState().setExternalEditLock(null);
    analyzeVideosInBatch.mockResolvedValue([]);
  });

  it('cancel aborts in-flight requests and leaves the timeline unchanged', async () => {
    const planRequested = deferred<AbortSignal>();
    post.mockImplementation(
      (_path: string, _body: unknown, opts: { signal: AbortSignal }) => {
        planRequested.resolve(opts.signal);
        return untilAborted(opts.signal);
      },
    );
    const before = currentTimeline();
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    let run: Promise<void> = Promise.resolve();
    let signal: AbortSignal | undefined;
    await act(async () => {
      run = result.current.start(QUICK);
      signal = await planRequested.promise;
    });
    await act(async () => {
      result.current.cancel();
      await run;
    });

    expect({ aborted: signal?.aborted, timeline: currentTimeline() })
      .toEqual({ aborted: true, timeline: before });
  });

  it('unmount aborts the run and ignores late responses', async () => {
    const planRequested = deferred<AbortSignal>();
    const lateResponse = deferred<unknown>();
    post.mockImplementation(
      (_path: string, _body: unknown, opts: { signal: AbortSignal }) => {
        planRequested.resolve(opts.signal);
        return lateResponse.promise;
      },
    );
    const before = currentTimeline();
    const { result, unmount } = renderHook(
      () => useAIMixedEditing(hookOptions()),
    );

    let run: Promise<void> = Promise.resolve();
    let signal: AbortSignal | undefined;
    await act(async () => {
      run = result.current.start(QUICK);
      signal = await planRequested.promise;
    });
    unmount();
    lateResponse.resolve({ success: true, timelineData: { metadata: {} } });
    await run;

    expect({
      aborted: signal?.aborted,
      requests: post.mock.calls.length,
      notified: Object.values(notify).some((fn) => fn.mock.calls.length > 0),
      timeline: currentTimeline(),
    }).toEqual({ aborted: true, requests: 1, notified: false, timeline: before });
  });

  it('applies the merged plan as a single undoable step', async () => {
    respondWithPlan();
    const before = currentTimeline().tracks;
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });
    const applied = currentTimeline().tracks
      .map((track) => [track.id, track.items.map((item) => item.id)]);
    const recorded = useTimelineStore.getState()._historyService.getActionCount();
    useTimelineStore.getState().undo();

    expect({ applied, recorded, restored: currentTimeline().tracks }).toEqual({
      applied: [['video-track-1', ['ai-clip']], ['subtitle-track-1', ['caption']]],
      recorded: 1,
      restored: before,
    });
  });

  it('shows a readable error toast when the planning request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    post.mockRejectedValue(
      new ApiError(502, 'AI_MIX_LLM_UPSTREAM_FAILED', 'upstream 500'),
    );
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });

    expect(notify.showError.mock.calls).toEqual([[en.aiMixingProgress.errorUpstream]]);
  });

  it('refuses to start while the agent is executing', async () => {
    const { result } = renderHook(
      () => useAIMixedEditing(hookOptions({ isAgentExecuting: true })),
    );

    await act(async () => { await result.current.start(QUICK); });

    expect({
      requests: post.mock.calls.length + analyzeVideosInBatch.mock.calls.length,
      warnings: notify.showWarning.mock.calls,
    }).toEqual({ requests: 0, warnings: [[en.aiMixingProgress.blockedByAgent]] });
  });

  it('opens the mode dialog with the clips it would replace and the tracks it keeps', () => {
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    act(() => { result.current.openModeModal(); });

    expect({
      isOpen: result.current.isModeModalOpen,
      impact: result.current.timelineImpact,
    }).toEqual({
      isOpen: true,
      impact: { replaceableItemCount: 1, preservedTrackNames: ['Subtitles'] },
    });
  });

  it('names an unnamed track it keeps by the label the timeline shows', () => {
    seedTimeline('');
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    act(() => { result.current.openModeModal(); });

    expect(result.current.timelineImpact.preservedTrackNames)
      .toEqual([`${en.timeline.track.subtitleShort} 1`]);
  });

  it('reports an unchanged timeline instead of offering an undo', async () => {
    respondWithPlan();
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });
    await act(async () => { await result.current.start(QUICK); });

    expect({
      recorded: useTimelineStore.getState()._historyService.getActionCount(),
      successes: notify.showSuccess.mock.calls.length,
      infos: notify.showInfo.mock.calls,
    }).toEqual({
      recorded: 1,
      successes: 1,
      infos: [[en.aiMixingProgress.noChanges]],
    });
  });

  it('does not apply a plan once the agent has taken the timeline', async () => {
    respondWithPlan();
    useTimelineStore.getState().setExternalEditLock('agent');
    const before = currentTimeline();
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });

    expect({
      timeline: currentTimeline(),
      warnings: notify.showWarning.mock.calls,
    }).toEqual({
      timeline: before,
      warnings: [[en.aiMixingProgress.blockedByAgent]],
    });
  });

  it('does not request a plan without video, audio or image materials', async () => {
    const subtitles: MaterialItem = {
      ...material, id: 'material-srt', type: 'subtitle', format: 'srt',
    };
    const { result } = renderHook(() => useAIMixedEditing(
      hookOptions({ getMaterials: () => [subtitles] }),
    ));

    await act(async () => { await result.current.start(QUICK); });

    expect({
      requests: post.mock.calls.length,
      errors: notify.showError.mock.calls,
    }).toEqual({ requests: 0, errors: [[en.aiMixingProgress.errorNoMaterials]] });
  });

  it('keeps the mode dialog closed without video, audio or image materials', () => {
    const subtitles: MaterialItem = {
      ...material, id: 'material-srt', type: 'subtitle', format: 'srt',
    };
    const { result } = renderHook(() => useAIMixedEditing(
      hookOptions({ getMaterials: () => [subtitles] }),
    ));

    act(() => { result.current.openModeModal(); });

    expect({
      isOpen: result.current.isModeModalOpen,
      errors: notify.showError.mock.calls,
    }).toEqual({ isOpen: false, errors: [[en.aiMixingProgress.errorNoMaterials]] });
  });

  it('shows errorImportFailed when the import endpoint rejects the plan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    post.mockImplementation((path: string) => (path === '/api/ai-mixed-editing'
      ? Promise.resolve({ success: true, timelineData: { metadata: { warnings: [] } } })
      : Promise.reject(new ApiError(400, 'HTTP_400', "{'errors': ['tracks[2].id duplicated']}"))));
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });

    expect(notify.showError.mock.calls).toEqual([[en.aiMixingProgress.errorImportFailed]]);
  });

  it('an unreachable backend during import reads as unreachable, not as an unusable plan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    post.mockImplementation((path: string) => (path === '/api/ai-mixed-editing'
      ? Promise.resolve({ success: true, timelineData: { metadata: { warnings: [] } } })
      : Promise.reject(new ApiError(502, 'BACKEND_UNREACHABLE', 'Backend unreachable: fetch failed'))));
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });

    expect(notify.showError.mock.calls).toEqual([[en.aiMixingProgress.errorBackendUnreachable]]);
  });

  it('counts packed items in the partial warning', async () => {
    const gapped: TimelineState = {
      ...importedPlan,
      tracks: importedPlan.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => ({ ...item, startTime: 2 })),
      })),
    };
    post.mockImplementation((path: string) => Promise.resolve(
      path === '/api/ai-mixed-editing'
        ? { success: true, timelineData: { metadata: { warnings: [] } } }
        : { success: true, importedData: { timelineState: gapped } },
    ));
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });

    expect({
      warnings: notify.showWarning.mock.calls,
      start: currentTimeline().tracks[0].items[0].startTime,
    }).toEqual({
      warnings: [[en.aiMixingProgress.partialWarning.replace('{count}', '1')]],
      start: 0,
    });
  });

  it('warns when footage analysis failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    respondWithPlan();
    analyzeVideosInBatch.mockResolvedValue([{ success: false }]);
    const { result } = renderHook(() => useAIMixedEditing(hookOptions()));

    await act(async () => { await result.current.start(QUICK); });

    expect(notify.showWarning.mock.calls)
      .toEqual([[en.aiMixingProgress.analysisIncomplete.replace('{count}', '1')]]);
  });
});

describe('mapAiMixError · every code (AM2-03)', () => {
  const backendText = "{'detail': 'Traceback (most recent call last): KeyError'}";
  const expectations: Array<[string, string]> = [
    ['AI_MIX_MODEL_NOT_CONFIGURED', en.aiMixingProgress.errorModelNotConfigured],
    ['AI_MIX_LLM_UPSTREAM_FAILED', en.aiMixingProgress.errorUpstream],
    ['AI_MIX_PLAN_UNPARSEABLE', en.aiMixingProgress.errorUnparseable],
    ['AI_MIX_INVALID_REQUEST', en.aiMixingProgress.errorNoMaterials],
    ['AI_MIX_INTERNAL', en.aiMixingProgress.errorInternal],
    ['BACKEND_TIMEOUT', en.aiMixingProgress.errorTimeout],
    ['BACKEND_UNREACHABLE', en.aiMixingProgress.errorBackendUnreachable],
    ['NETWORK_ERROR', en.aiMixingProgress.errorBackendUnreachable],
    ['VALIDATION_ERROR', en.aiMixingProgress.errorInvalidRequest],
    ['TIMELINE_IMPORT_INVALID', en.aiMixingProgress.errorImportFailed],
    ['HTTP_500', en.aiMixingProgress.errorInternal],
  ];

  it('maps every AI_MIX_* and proxy error code to a localized message without backend text', () => {
    const mapped = expectations
      .map(([code]) => mapAiMixError(new ApiError(500, code, backendText), en));

    expect({
      mapped,
      leaksBackendText: mapped.some((message) => message.includes('Traceback')),
    }).toEqual({
      mapped: expectations.map(([, message]) => message),
      leaksBackendText: false,
    });
  });

  it('maps import failures to errorImportFailed', () => {
    const error = new AiMixImportError(new ApiError(400, 'HTTP_400', backendText));

    expect(mapAiMixError(error, en)).toBe(en.aiMixingProgress.errorImportFailed);
  });
});

describe('mapAiMixError', () => {
  it('maps AI_MIX_MODEL_NOT_CONFIGURED to the settings hint', () => {
    const error = new ApiError(
      503,
      'AI_MIX_MODEL_NOT_CONFIGURED',
      'No model is assigned to video editing',
    );

    expect(mapAiMixError(error, en))
      .toBe(en.aiMixingProgress.errorModelNotConfigured);
  });

  it('maps a request timeout to the timeout hint', () => {
    expect(mapAiMixError(new TimeoutError(), en))
      .toBe(en.aiMixingProgress.errorTimeout);
  });

  it('wraps any other failure in the generic message', () => {
    expect(mapAiMixError(new Error('disk full'), en))
      .toBe('AI auto edit failed: disk full');
  });
});

describe('toAiMixMaterialDtos', () => {
  it('toAiMixMaterialDtos strips blob thumbnails and heavy metadata', () => {
    const dtos = toAiMixMaterialDtos([{
      ...material,
      thumbnailUrl: 'blob:http://127.0.0.1:3000/5f1c',
      description: 'Skyline at dusk',
      tags: ['city'],
      metadata: {
        segment_id: 'segment-1',
        segment_number: 1,
        video_analysis: { summary: 'skyline' },
        srt_content: '1\n00:00:00,000 --> 00:00:02,000\nhello',
        sentence_timing: [{ start: 0, end: 2 }],
        subtitles: [{ text: 'hello' }],
      },
    }]);

    expect(dtos).toEqual([{
      id: 'material-video',
      name: 'city.mp4',
      type: 'video',
      format: 'mp4',
      size: 1024,
      duration: 5,
      url: '/api/storage/files/video/city.mp4',
      description: 'Skyline at dusk',
      tags: ['city'],
      createdAt: '2026-09-13T08:00:00.000Z',
      metadata: {
        segment_id: 'segment-1',
        segment_number: 1,
        video_analysis: { summary: 'skyline' },
      },
    }]);
  });
});
