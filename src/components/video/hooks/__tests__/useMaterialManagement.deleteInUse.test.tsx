/**
 * ME-02 / ME-01: deleting a material the timeline uses.
 *
 * The timeline store is real so the undo step is exercised end to end; the
 * upload / download / prefetch hooks, caches and backend client are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getTranslations } from '@/lib/i18n';
import type { MaterialItem } from '@/types';
import type { TrackData } from '../../timeline/domain/types';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import { useMaterialManagement } from '../useMaterialManagement';

const notify = {
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
};
const deleteMaterialDerived = vi.fn();
const filmstripEvict = vi.fn();

vi.mock('@/contexts/NotificationContext', () => ({
  useNotification: () => notify,
}));

vi.mock('@/contexts/LocaleContext', async () => {
  const { getTranslations: loadTranslations } = await import('@/lib/i18n');
  const t = loadTranslations('en');
  return { useLocale: () => ({ t, locale: 'en', setLocale: () => {} }) };
});

vi.mock('../useRemoteMaterialPrefetch', () => ({
  useRemoteMaterialPrefetch: () => undefined,
}));

vi.mock('../useLocalMaterialDownload', () => ({
  useLocalMaterialDownload: () => ({ retryLocalDownload: () => undefined, evictLocalMaterial: () => undefined }),
}));

vi.mock('../materialManagement/useMaterialUpload', () => ({
  useMaterialUpload: () => ({
    isUploading: false,
    uploadProgress: 0,
    handleMaterialUpload: () => undefined,
    handleDragUpload: () => undefined,
    triggerAutoAnalysis: () => undefined,
  }),
}));

vi.mock('../materialManagement/useMaterialGeneration', () => ({
  useMaterialGeneration: () => ({
    handleAiVideoGenerate: async () => undefined,
    handleAiImageGenerate: async () => undefined,
    handleStoryboardGenerate: async () => undefined,
  }),
}));

vi.mock('../../lib/api/materialCacheClient', () => ({
  deleteMaterialDerived: (...args: unknown[]) => deleteMaterialDerived(...args),
}));

vi.mock('../../lib/filmstrip/filmstripCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/filmstrip/filmstripCache')>()),
  filmstripCache: { evict: (id: string) => filmstripEvict(id) },
}));

vi.mock('../../lib/waveform/waveformCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/waveform/waveformCache')>()),
  waveformCache: { evict: () => undefined },
}));

vi.mock('../useVideoCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../useVideoCache')>()),
  dropVideoCacheMaterial: () => undefined,
}));

const en = getTranslations('en');

function material(id: string): MaterialItem {
  return {
    id,
    name: `${id}.mp4`,
    type: 'video',
    format: 'mp4',
    size: 1,
    duration: 5,
    url: `/api/storage/files/video/${id}.mp4`,
    storageKey: `video/${id}.mp4`,
    createdAt: new Date('2026-09-14T00:00:00.000Z'),
  };
}

function clip(id: string, materialId: string, trackId: string, startTime: number): TrackData['items'][number] {
  return {
    id, name: id, type: 'video', startTime, duration: 5, trackId, color: '#4A90D9',
    materialId, clipStart: 0, clipEnd: 5, originalDuration: 5,
  };
}

function lane(id: string, items: TrackData['items'], isLocked = false): TrackData {
  return {
    id, name: id, type: 'video', height: 60, isLocked, isMuted: false, isVisible: true,
    volume: 100, order: 0, items,
  };
}

function seedTimeline(tracks: TrackData[]): void {
  const store = useTimelineStore.getState();
  store.setExternalEditLock(null);
  store.importFromData({
    currentTime: 0, totalDuration: 10, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: true, gridSize: 0.5, scrollLeft: 0, tracks,
  });
  store.clearHistory();
}

function timelineItemIds(): string[] {
  return useTimelineStore.getState().tracks
    .reduce<string[]>((ids, track) => ids.concat(track.items.map((item) => item.id)), [])
    .sort();
}

/** Lets the fire-and-forget cleanup promise chain settle (a macrotask drains every microtask). */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function renderManagement(materials: MaterialItem[]) {
  return renderHook(() => useMaterialManagement('task-1', materials));
}

beforeEach(() => {
  Object.values(notify).forEach((fn) => fn.mockReset());
  deleteMaterialDerived.mockReset();
  deleteMaterialDerived.mockResolvedValue({ success: true, deleted: [] });
  filmstripEvict.mockReset();
});

afterEach(() => {
  useTimelineStore.getState().setExternalEditLock(null);
  vi.restoreAllMocks();
});

describe('useMaterialManagement — deleting a material in use', () => {
  it('deleting an in-use material removes its clips as one undo step', () => {
    seedTimeline([
      lane('video-track-1', [clip('c1', 'm1', 'video-track-1', 0), clip('c2', 'm2', 'video-track-1', 5)]),
      lane('video-track-2', [clip('c3', 'm1', 'video-track-2', 0)]),
    ]);
    const { result } = renderManagement([material('m1'), material('m2')]);

    act(() => result.current.handleMaterialDelete(['m1']));
    expect(result.current.confirmationDialog.message).toBe(
      en.materialsPanel.deleteInUseBody.replace('{name}', 'm1.mp4').replace('{count}', '2'),
    );
    act(() => result.current.confirmationDialog.onConfirm());

    expect(timelineItemIds()).toEqual(['c2']);
    expect(result.current.allMaterials.map((entry) => entry.id)).toEqual(['m2']);
    act(() => useTimelineStore.getState().undo());
    expect(timelineItemIds()).toEqual(['c1', 'c2', 'c3']);
  });

  it('an unused material asks with the plain delete message', () => {
    seedTimeline([lane('video-track-1', [clip('c2', 'm2', 'video-track-1', 0)])]);
    const { result } = renderManagement([material('m1'), material('m2')]);

    act(() => result.current.handleMaterialDelete(['m1']));

    expect(result.current.confirmationDialog.title).toBe(en.materialsPanel.deleteConfirmTitle);
    expect(result.current.confirmationDialog.message).toBe(
      en.materialsPanel.deleteConfirmBody.replace('{name}', 'm1.mp4'),
    );
  });

  it('refuses when a using clip sits on a locked track', () => {
    seedTimeline([lane('video-track-1', [clip('c1', 'm1', 'video-track-1', 0)], true)]);
    const { result } = renderManagement([material('m1')]);

    act(() => result.current.handleMaterialDelete(['m1']));

    expect(notify.showWarning).toHaveBeenCalledWith(en.materialsPanel.deleteBlockedLocked.replace('{count}', '1'));
    expect(result.current.confirmationDialog.isOpen).toBe(false);
    expect(deleteMaterialDerived).not.toHaveBeenCalled();
  });

  it('refuses while the agent holds the edit lock', () => {
    seedTimeline([lane('video-track-1', [clip('c1', 'm1', 'video-track-1', 0)])]);
    useTimelineStore.getState().setExternalEditLock('agent');
    const { result } = renderManagement([material('m1')]);

    act(() => result.current.handleMaterialDelete(['m1']));

    expect(notify.showWarning).toHaveBeenCalledWith(en.timeline.messages.editLockedByAgent);
    expect(result.current.confirmationDialog.isOpen).toBe(false);
  });

  it('replacing a material url under the same id evicts its caches', () => {
    seedTimeline([]);
    const { result } = renderManagement([material('m1')]);

    act(() => { result.current.addOrReplaceMaterial({ ...material('m1'), url: '/api/storage/files/video/m1_clean.mp4' }); });
    expect(filmstripEvict).toHaveBeenCalledWith('m1');

    filmstripEvict.mockReset();
    act(() => { result.current.addOrReplaceMaterial({ ...material('m1'), url: '/api/storage/files/video/m1_clean.mp4', name: 'renamed' }); });
    expect(filmstripEvict).not.toHaveBeenCalled();
  });

  it('a failed delete after removing clips tells the user to undo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteMaterialDerived.mockImplementation(() => { throw new Error('backend unreachable'); });
    seedTimeline([lane('video-track-1', [clip('c1', 'm1', 'video-track-1', 0), clip('c2', 'm2', 'video-track-1', 5)])]);
    const { result } = renderManagement([material('m1'), material('m2')]);

    act(() => result.current.handleMaterialDelete(['m1']));
    act(() => result.current.confirmationDialog.onConfirm());

    expect(notify.showError).toHaveBeenCalledWith(en.materialsPanel.deleteFailedClipsRemoved);
    expect(timelineItemIds()).toEqual(['c2']);
    expect(result.current.allMaterials.map((entry) => entry.id)).toContain('m1');
  });

  it('clearing all materials removes their clips as one undo step', async () => {
    seedTimeline([lane('video-track-1', [clip('c1', 'm1', 'video-track-1', 0), clip('c2', 'kept', 'video-track-1', 5)])]);
    const { result } = renderManagement([material('m1'), material('m2')]);

    act(() => result.current.handleClearAllMaterials());
    expect(result.current.confirmationDialog.message).toBe(
      en.materialsPanel.clearAllInUseMessage.replace('{count}', '2').replace('{clipCount}', '1'),
    );
    await act(async () => { await (result.current.confirmationDialog.onConfirm() as unknown); });

    expect({ clips: timelineItemIds(), materials: result.current.allMaterials }).toEqual({ clips: ['c2'], materials: [] });
    expect(filmstripEvict.mock.calls.map(([id]) => id)).toEqual(['m1', 'm2']);
    act(() => useTimelineStore.getState().undo());
    expect(timelineItemIds()).toEqual(['c1', 'c2']);
  });

  it('clearing all materials is refused while a used clip is on a locked track', () => {
    seedTimeline([lane('video-track-1', [clip('c1', 'm1', 'video-track-1', 0)], true)]);
    const { result } = renderManagement([material('m1')]);

    act(() => result.current.handleClearAllMaterials());

    expect({
      warnings: notify.showWarning.mock.calls,
      isOpen: result.current.confirmationDialog.isOpen,
      materials: result.current.allMaterials.map((entry) => entry.id),
    }).toEqual({
      warnings: [[en.materialsPanel.deleteBlockedLocked.replace('{count}', '1')]],
      isOpen: false,
      materials: ['m1'],
    });
  });

  it('warns once when the backend cleanup of a delete fails', async () => {
    deleteMaterialDerived.mockResolvedValue({ success: false, deleted: { source: false, thumbnails: 0, waveform: false } });
    seedTimeline([]);
    const { result } = renderManagement([material('m1'), material('m2')]);

    act(() => result.current.handleMaterialDelete(['m1', 'm2']));
    await act(async () => {
      result.current.confirmationDialog.onConfirm();
      await flushPromises();
    });

    expect(notify.showWarning.mock.calls).toEqual([[en.materialsPanel.deleteCleanupFailed.replace('{count}', '2')]]);
  });

  it('discarding placeholders never warns about cleanup', async () => {
    deleteMaterialDerived.mockResolvedValue({ success: false, deleted: { source: false, thumbnails: 0, waveform: false } });
    seedTimeline([]);
    const { result } = renderManagement([material('placeholder')]);

    await act(async () => {
      result.current.discardPendingMaterials(['placeholder']);
      await flushPromises();
    });

    expect({ warnings: notify.showWarning.mock.calls, materials: result.current.allMaterials })
      .toEqual({ warnings: [], materials: [] });
  });

  it('does not delete the source file of a material that shares it', () => {
    seedTimeline([]);
    const shared = { ...material('derived'), storageKey: 'video/m1.mp4' };
    const { result } = renderManagement([material('m1'), shared]);

    act(() => result.current.handleMaterialDelete(['derived']));
    act(() => result.current.confirmationDialog.onConfirm());

    expect(deleteMaterialDerived).toHaveBeenCalledWith(expect.objectContaining({ materialId: 'derived', sourcePath: undefined }));
  });
});
