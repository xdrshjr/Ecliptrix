import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../useTimelineStore';
import { applyEffectsTimelineAction } from '../applyEffects';
import type { EffectAsset } from '@/types/effects';

const asset = { id: 'a', projectId: 'p', kind: 'output-video',
  url: '/api/storage/files/effects/projects/p/outputs/j/video.mp4',
  storageKey: 'effects/projects/p/outputs/j/video.mp4',
  width: 1920, height: 1080, bytes: 1024, durationSeconds: 3.4,
  createdAt: '2026-11-17', sha256: 'hash',
  effects: { schemaVersion: 1, projectId: 'p', draftId: 'd',
    draftVersion: 1, jobId: 'j', assetId: 'a', templateId: 'title-rise',
    templateVersion: 1, documentHash: 'hash' },
} as EffectAsset;
const getStore = () => useTimelineStore.getState();
const registerMaterial = vi.fn();
const apply = () => applyEffectsTimelineAction({ getStore,
  getProjectId: () => 'p', registerMaterial, asset,
  intent: { projectId: 'p', operationId: 'op', mode: 'insert', startTime: 2 } });

beforeEach(() => {
  getStore().setExternalEditLock(null);
  useTimelineStore.setState({ isInteracting: false });
  getStore().initTimeline({ currentTime: 0, totalDuration: 1, zoomLevel: 1,
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1,
    scrollLeft: 0, tracks: [] });
  getStore().clearHistory(); registerMaterial.mockClear();
});

describe('特效单次真实时间线事务', () => {
  it('插入幂等、一次撤销重做且不重新注册素材', () => {
    apply(); expect(apply().status).toBe('noop');
    expect(getStore().tracks[0].items[0].startTime).toBe(2);
    getStore().undo(); expect(getStore().tracks).toHaveLength(0);
    getStore().redo(); expect(getStore().tracks[0].items[0].cacheUrl)
      .toBe(asset.url);
    expect(registerMaterial).toHaveBeenCalledTimes(1);
  });
  it('活动手势和注册期间锁变化均拒绝，不取消用户手势', () => {
    useTimelineStore.setState({ isInteracting: true });
    expect(apply).toThrow('EFFECT_ACTIVE_GESTURE');
    expect(getStore().isInteracting).toBe(true);
    expect(registerMaterial).not.toHaveBeenCalled();
    useTimelineStore.setState({ isInteracting: false });
    expect(() => applyEffectsTimelineAction({ getStore,
      getProjectId: () => 'p', asset,
      registerMaterial: () => getStore().setExternalEditLock('agent'),
      intent: { projectId: 'p', operationId: 'op', mode: 'insert', startTime: 2 },
    })).toThrow('EFFECT_EDIT_LOCKED');
    expect(getStore().tracks).toHaveLength(0);
  });
});
