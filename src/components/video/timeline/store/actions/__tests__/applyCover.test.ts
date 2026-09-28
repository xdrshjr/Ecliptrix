import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverRevision } from '@/types/videoCover';
import { useTimelineStore } from '../../useTimelineStore';
import { applyCoverTimelineAction } from '../applyCover';

const revision = { id: 'r1', projectId: 'p', url: '/api/storage/files/cover.png',
  assetId: 'a1', sha256: 'hash', width: 1920, height: 1080,
  createdAt: '2026-09-28', document: { mode: 'html', fields: { title: '封面' }, durationFrames: 30 },
} as CoverRevision;
const getStore = () => useTimelineStore.getState();
const registerMaterial = vi.fn();
const apply = () => applyCoverTimelineAction({ getStore, projectId: 'p',
  getProjectId: () => 'p', revision, registerMaterial });
beforeEach(() => {
  getStore().setExternalEditLock(null);
  useTimelineStore.setState({ isInteracting: false });
  getStore().initTimeline({ currentTime: 0, totalDuration: 1, zoomLevel: 1,
    playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1,
    scrollLeft: 0, tracks: [] });
  getStore().clearHistory(); registerMaterial.mockClear();
});
describe('封面单步历史命令', () => {
  it('一次撤销和重做完整恢复且不删除成品素材', () => {
    apply(); expect(getStore().tracks[0].items).toHaveLength(1);
    getStore().undo(); expect(getStore().tracks).toHaveLength(0);
    getStore().redo(); expect(getStore().tracks[0].items[0].metadata?.cover?.revisionId).toBe('r1');
    expect(registerMaterial).toHaveBeenCalledTimes(1);
  });
  it('活动手势失败而不取消手势或注册素材', () => {
    useTimelineStore.setState({ isInteracting: true });
    expect(apply).toThrow();
    expect(getStore().isInteracting).toBe(true);
    expect(registerMaterial).not.toHaveBeenCalled();
  });
  it('拒绝已经切换的项目', () => {
    expect(() => applyCoverTimelineAction({ getStore, projectId: 'p',
      getProjectId: () => 'other', revision, registerMaterial })).toThrow();
    expect(registerMaterial).not.toHaveBeenCalled();
  });
  it('重复同成品没有额外撤销步骤', () => {
    apply(); expect(apply().status).toBe('noop');
    getStore().undo(); expect(getStore().tracks).toHaveLength(0);
  });
});
