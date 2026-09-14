/**
 * DS3-02: the panel's material list and the shared store must agree on
 * deletes, or the agent adding any material brings a deleted one back.
 *
 * The stores are real; upload / download / prefetch hooks, caches and the
 * backend delete client are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MaterialItem } from '@/types';
import { useVideoEditingStore } from '@/stores';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import { useMaterialManagement } from '../useMaterialManagement';

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
  deleteMaterialDerived: async () => ({ success: true, deleted: { source: true, thumbnails: 0, waveform: false } }),
}));

vi.mock('../useVideoCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../useVideoCache')>()),
  dropVideoCacheMaterial: () => undefined,
}));

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

const storeIds = () => useVideoEditingStore.getState().materials.map((entry) => entry.id);

beforeEach(() => {
  Object.values(notify).forEach((fn) => fn.mockReset());
  useVideoEditingStore.getState().clearMaterials();
  const timeline = useTimelineStore.getState();
  timeline.setExternalEditLock(null);
  timeline.importFromData({
    currentTime: 0, totalDuration: 0, zoomLevel: 1, playbackRate: 1, isPlaying: false,
    snapToGrid: true, gridSize: 0.5, scrollLeft: 0, tracks: [],
  });
  timeline.clearHistory();
});

describe('useMaterialManagement — store sync', () => {
  it('a material deleted in the panel is not re-added when the agent adds another', () => {
    const { result } = renderHook(() => useMaterialManagement('task-1', []));
    act(() => useVideoEditingStore.getState().addMaterial(material('m')));
    expect(result.current.allMaterials.map((entry) => entry.id)).toEqual(['m']);

    act(() => result.current.handleMaterialDelete(['m']));
    act(() => result.current.confirmationDialog.onConfirm());
    act(() => useVideoEditingStore.getState().addMaterial(material('n')));

    expect(result.current.allMaterials.map((entry) => entry.id)).toEqual(['n']);
  });

  it('deleting a material removes it from the shared store', () => {
    useVideoEditingStore.getState().addMaterial(material('m1'));
    useVideoEditingStore.getState().addMaterial(material('m2'));
    const { result } = renderHook(() => useMaterialManagement('task-1', [material('m1'), material('m2')]));

    act(() => result.current.handleMaterialDelete(['m1']));
    act(() => result.current.confirmationDialog.onConfirm());

    expect({ panel: result.current.allMaterials.map((entry) => entry.id), store: storeIds() })
      .toEqual({ panel: ['m2'], store: ['m2'] });
  });
});
