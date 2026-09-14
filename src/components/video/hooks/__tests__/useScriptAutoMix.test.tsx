/**
 * useScriptAutoMix — script auto-mix orchestration (AS2-02 / AS2-04).
 *
 * The contexts are mocked; the timeline store and the planner are real, so
 * what lands on the lanes is asserted end to end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getTranslations } from '@/lib/i18n';
import type { MaterialItem } from '@/types';
import type { TimelineItemData, TrackData } from '../../timeline/domain';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import { useScriptAutoMix } from '../useScriptAutoMix';
import type { UseScriptAutoMixOptions } from '../useScriptAutoMix';

const notify = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};

vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => notify,
}));

vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations: loadTranslations } = await import('@/lib/i18n');
  const t = loadTranslations('en');
  return { useLocale: () => ({ t, locale: 'en', setLocale: () => {} }) };
});

const en = getTranslations('en');

function scriptMaterial(
  id: string,
  type: 'audio' | 'video',
  duration: number,
  segment: number,
  assignedAt = 1,
): MaterialItem {
  return {
    id,
    name: id,
    type,
    format: type === 'audio' ? 'mp3' : 'mp4',
    size: 1,
    duration,
    url: `/api/storage/files/${id}`,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    metadata: {
      segment_id: `segment-${segment}`,
      segment_number: segment,
      segment_assigned_at: assignedAt,
    },
  };
}

function existingItem(trackId: string, type: TrackData['type'], index: number): TimelineItemData {
  return {
    id: `${trackId}-existing-${index}`,
    name: 'existing',
    type,
    startTime: index * 2,
    duration: 2,
    trackId,
    color: '#6b7280',
  };
}

function lane(id: string, type: TrackData['type'], order: number, itemCount: number): TrackData {
  return {
    id,
    name: id,
    type,
    height: 60,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order,
    items: Array.from({ length: itemCount }, (_, index) => existingItem(id, type, index)),
  };
}

function seedTimeline(videoItems: number, audioItems: number): void {
  useTimelineStore.getState().setExternalEditLock(null);
  useTimelineStore.getState().initTimeline({
    currentTime: 0,
    totalDuration: 4,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
    tracks: [
      lane('video-track-1', 'video', 0, videoItems),
      lane('audio-track-1', 'audio', 1, audioItems),
    ],
  });
  useTimelineStore.getState().clearHistory();
}

function options(overrides: Partial<UseScriptAutoMixOptions> = {}): UseScriptAutoMixOptions {
  return {
    taskId: 'task-1',
    getMaterials: () => [],
    getScriptSegments: () => undefined,
    ...overrides,
  };
}

const laneMaterialIds = (index: number) => useTimelineStore.getState()
  .exportToData().tracks[index].items.map((item) => item.materialId ?? item.id);

describe('useScriptAutoMix', () => {
  beforeEach(() => {
    seedTimeline(1, 1);
  });

  it('applies the materials present at confirm time, not at click time', () => {
    let materials = [
      scriptMaterial('tts-old', 'audio', 3, 1, 1),
      scriptMaterial('video-1', 'video', 5, 1, 1),
    ];
    const { result } = renderHook(() => useScriptAutoMix(options({ getMaterials: () => materials })));

    act(() => { result.current.requestAutoMix(); });
    // TTS finished while the replace prompt was open.
    materials = [...materials, scriptMaterial('tts-new', 'audio', 4, 1, 2)];
    act(() => { result.current.confirmAutoMix(); });

    expect({
      isOpen: result.current.confirmState.isOpen,
      audio: laneMaterialIds(1),
    }).toEqual({ isOpen: false, audio: ['tts-new'] });
  });

  it('reopens the confirmation when the replaced clip count changed', () => {
    const materials = [
      scriptMaterial('tts-1', 'audio', 3, 1),
      scriptMaterial('video-1', 'video', 5, 1),
    ];
    const { result } = renderHook(() => useScriptAutoMix(options({ getMaterials: () => materials })));

    act(() => { result.current.requestAutoMix(); });
    const shown = result.current.confirmState.replacedItemCount;
    seedTimeline(3, 1); // the user added clips while the prompt was open
    act(() => { result.current.confirmAutoMix(); });

    expect({
      shown,
      confirmState: result.current.confirmState,
      video: laneMaterialIds(0),
    }).toEqual({
      shown: 2,
      confirmState: { isOpen: true, replacedItemCount: 4 },
      video: ['video-track-1-existing-0', 'video-track-1-existing-1', 'video-track-1-existing-2'],
    });
  });

  it('applies without asking again when the clips to replace are gone at confirm time', () => {
    const materials = [
      scriptMaterial('tts-1', 'audio', 3, 1),
      scriptMaterial('video-1', 'video', 5, 1),
    ];
    const { result } = renderHook(() => useScriptAutoMix(options({ getMaterials: () => materials })));

    act(() => { result.current.requestAutoMix(); });
    seedTimeline(0, 0); // the user emptied both lanes while the prompt was open
    act(() => { result.current.confirmAutoMix(); });

    expect({
      isOpen: result.current.confirmState.isOpen,
      video: laneMaterialIds(0),
      audio: laneMaterialIds(1),
    }).toEqual({ isOpen: false, video: ['video-1'], audio: ['tts-1'] });
  });

  it('passes the current script segments to the planner', () => {
    seedTimeline(0, 0);
    const materials = [
      scriptMaterial('tts-1', 'audio', 3, 1),
      scriptMaterial('video-1', 'video', 5, 1),
      scriptMaterial('tts-2', 'audio', 2, 2),
      scriptMaterial('video-2', 'video', 5, 2),
    ];
    const { result } = renderHook(() => useScriptAutoMix(options({
      getMaterials: () => materials,
      getScriptSegments: () => [{ id: 'segment-2' }],
    })));

    act(() => { result.current.requestAutoMix(); });

    expect({
      audio: laneMaterialIds(1),
      infos: notify.showInfo.mock.calls,
    }).toEqual({
      audio: ['tts-2'],
      infos: [[en.videoEditing.autoMix.orphansIgnored.replace('{count}', '2')]],
    });
  });

  it('refuses while the agent holds the edit lock without asking to replace', () => {
    useTimelineStore.getState().setExternalEditLock('agent');
    const before = useTimelineStore.getState().exportToData().tracks;
    const { result } = renderHook(() => useScriptAutoMix(options({
      getMaterials: () => [scriptMaterial('tts-1', 'audio', 3, 1)],
    })));

    act(() => { result.current.requestAutoMix(); });

    expect({
      isOpen: result.current.confirmState.isOpen,
      warnings: notify.showWarning.mock.calls,
      tracks: useTimelineStore.getState().exportToData().tracks,
    }).toEqual({
      isOpen: false,
      warnings: [[en.timeline.messages.editLockedByAgent]],
      tracks: before,
    });
  });

  it('warns about segments whose video cannot cover the voice-over', () => {
    seedTimeline(0, 0);
    const { result } = renderHook(() => useScriptAutoMix(options({
      getMaterials: () => [
        scriptMaterial('tts-1', 'audio', 0.15, 1),
        scriptMaterial('blip', 'video', 0.12, 1),
      ],
    })));

    act(() => { result.current.requestAutoMix(); });

    expect(notify.showWarning.mock.calls)
      .toEqual([[en.videoEditing.autoMix.videoShort.replace('{list}', '1')]]);
  });
});
