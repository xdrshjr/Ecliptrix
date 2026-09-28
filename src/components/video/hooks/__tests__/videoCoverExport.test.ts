import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CoverAspectRatio, CoverRevision } from '@/types/videoCover';
import type { TimelineState } from '@/types';
import { getTranslations } from '@/lib/i18n';
import { createCoverMaterial, planCoverTimelineChange } from '../../cover/coverTimeline';
import { coverSize } from '../../cover/layout';
import { buildExportCompositionItems, validateCoverExport } from '../videoExportItems';
import { deferred } from './useVideoExport.fixtures';

const mocks = vi.hoisted(() => ({ compose: vi.fn(), revision: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api/videoComposition', () => ({ videoCompositionAPI: {
  composeVideo: mocks.compose, pollCompositionStatus: vi.fn(async () => undefined),
  triggerDownload: vi.fn(async () => undefined),
} }));
vi.mock('@/lib/api/videoCoverV2', () => ({ videoCoverV2: { getRevision: mocks.revision } }));
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({
  showError: mocks.error, showInfo: vi.fn(), showWarning: vi.fn(), showSuccess: vi.fn(),
}) }));
vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: getTranslations('zh-CN'), locale: 'zh-CN' }) }));
import { useVideoExport } from '../useVideoExport';

const revision = { id: 'r1', projectId: 'p', url: '/api/storage/files/cover.png',
  assetId: 'a1', sha256: 'hash', width: 1920, height: 1080,
  createdAt: '2026-09-28', document: { mode: 'html', aspectRatio: '16:9', fields: { title: '封面' }, durationFrames: 30 },
} as CoverRevision;
function fixture() {
  const timeline = planCoverTimelineChange({ projectId: 'p', revision, timeline: {
    currentTime: 0, totalDuration: 1, zoomLevel: 1, playbackRate: 1,
    isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0, tracks: [],
  } }).timeline;
  return { timelineState: { ...timeline, selectedItems: [] } as TimelineState,
    materials: [createCoverMaterial(revision)] };
}
const check = (data: ReturnType<typeof fixture>) => validateCoverExport({
  projectId: 'p', aspectRatio: '16:9', tracks: data.timelineState.tracks,
  materialsById: new Map(data.materials.map(material => [material.id, material])),
});
let task = 0;
beforeEach(() => {
  mocks.compose.mockReset().mockResolvedValue({ success: true, composition_id: 'composition' });
  mocks.revision.mockReset().mockResolvedValue(revision); mocks.error.mockClear(); task++;
});
describe('封面严格导出', () => {
  it.each<CoverAspectRatio>(['16:9', '9:16', '1:1', '4:3', '21:9'])(
    '%s使用产品输出尺寸通过预检', aspectRatio => {
      const data = fixture();
      Object.assign(data.materials[0], coverSize(aspectRatio));
      expect(validateCoverExport({
        projectId: 'p', aspectRatio, tracks: data.timelineState.tracks,
        materialsById: new Map(data.materials.map(material => [material.id, material])),
      }).status).toBe('ready');
    });

  it.each(['ready', 'failed'])('封面预检期间取消后忽略迟到的%s结果', async outcome => {
    const ready = deferred<CoverRevision>();
    mocks.revision.mockReturnValueOnce(ready.promise);
    const onCoverCheck = vi.fn();
    const onAdvisories = vi.fn();
    const { result } = renderHook(() => useVideoExport({
      ...fixture(), taskId: `t${task}`, projectId: 'p',
      preflight: { collect: () => [], onAdvisories, onCoverCheck },
    }));
    let running: Promise<void>;
    act(() => { running = result.current.handleExport(); });
    await act(async () => { await result.current.cancelExport(); });
    await act(async () => {
      if (outcome === 'ready') ready.resolve(revision);
      else ready.reject(new Error('Asset lookup failed'));
      await running!;
    });
    expect(mocks.compose).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(onCoverCheck).not.toHaveBeenCalled();
    expect(onAdvisories).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });

  it('封面预检期间取消不会再提交合成任务', async () => {
    const ready = deferred<CoverRevision>();
    mocks.revision.mockReturnValueOnce(ready.promise);
    const { result } = renderHook(() => useVideoExport({
      ...fixture(), taskId: `t${task}`, projectId: 'p',
    }));
    let running: Promise<void>;
    act(() => { running = result.current.handleExport(); });
    await act(async () => { await result.current.cancelExport(); });
    await act(async () => { ready.resolve(revision); await running!; });
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it('唯一封面图片没有二次插入，只有封面也可导出', () => {
    const data = fixture();
    const items = buildExportCompositionItems(data.timelineState.tracks,
      new Map(data.materials.map(material => [material.id, material])));
    expect(items.imageItems).toHaveLength(1); expect(check(data).status).toBe('ready');
  });
  it.each(['duplicate', 'moved', 'transparent', 'missing', 'ratio'])(
    '%s 始终拒绝', kind => {
      const data = fixture(); const item = data.timelineState.tracks[0].items[0];
      if (kind === 'duplicate') data.timelineState.tracks[0].items.push({ ...item, id: 'other' });
      if (kind === 'moved') item.startTime = 1;
      if (kind === 'transparent') item.opacity = 0.5;
      if (kind === 'missing') data.materials = [];
      if (kind === 'ratio') data.materials[0].width = 1080;
      expect(check(data).status).toBe('error');
    });
  it('skipAdvisories不能绕过片头硬错误', async () => {
    const data = fixture(); data.timelineState.tracks[0].items[0].startTime = 1;
    const { result } = renderHook(() => useVideoExport({ ...data, taskId: `t${task}`, projectId: 'p' }));
    await act(async () => { await result.current.handleExport({ skipAdvisories: true }); });
    expect(mocks.compose).not.toHaveBeenCalled(); expect(mocks.error).toHaveBeenCalled();
  });
  it('可见锁定封面仍可导出，侵入字幕被拒绝', () => {
    const data = fixture(); data.timelineState.tracks[0].isLocked = true;
    expect(check(data).status).toBe('ready');
    data.timelineState.tracks.push({ ...data.timelineState.tracks[0], id: 'subtitle', type: 'subtitle',
      items: [{ id: 'subtitle', name: '', type: 'subtitle', trackId: 'subtitle',
        color: '#fff', startTime: 0.5, duration: 1, text: '侵入' }] });
    expect(check(data).status).toBe('error');
  });
  it('隐藏确认允许正文导出并省略required_cover', async () => {
    const data = fixture(); const cover = data.timelineState.tracks[0];
    const ordinary = structuredClone(cover);
    ordinary.id = 'image-track-body'; ordinary.items[0].id = 'body';
    ordinary.items[0].trackId = ordinary.id; ordinary.items[0].startTime = 1;
    ordinary.items[0].metadata = {};
    cover.isVisible = false; data.timelineState.tracks.push(ordinary);
    const checked = check(data); if (checked.status !== 'hidden') throw new Error('expected hidden');
    const { result } = renderHook(() => useVideoExport({ ...data, taskId: `t${task}`, projectId: 'p' }));
    await act(async () => { await result.current.handleExport({ confirmedHiddenCoverDigest: checked.digest }); });
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({
      image_items: [expect.objectContaining({ id: 'body' })],
    }));
    expect(mocks.compose.mock.calls[0][0].required_cover).toBeUndefined();
  });
  it('隐藏确认绑定轨道摘要，改变后不能继续', async () => {
    const data = fixture(); data.timelineState.tracks[0].isVisible = false;
    const initial = check(data); expect(initial.status).toBe('hidden');
    if (initial.status !== 'hidden') return;
    data.timelineState.tracks[0].name = 'changed';
    const onCoverCheck = vi.fn();
    const { result } = renderHook(() => useVideoExport({ ...data, taskId: `t${task}`, projectId: 'p',
      preflight: { collect: () => [], onAdvisories: vi.fn(), onCoverCheck } }));
    await act(async () => { await result.current.handleExport({ skipAdvisories: true,
      confirmedHiddenCoverDigest: initial.digest }); });
    expect(onCoverCheck).toHaveBeenCalled(); expect(mocks.compose).not.toHaveBeenCalled();
  });
  it('异步校验期间修改实时对象不会改变已经捕获的成品快照', async () => {
    const data = fixture(); const ready = deferred<CoverRevision>();
    mocks.revision.mockReturnValueOnce(ready.promise);
    const { result } = renderHook(() => useVideoExport({ ...data, taskId: `t${task}`, projectId: 'p' }));
    let running: Promise<void>;
    act(() => { running = result.current.handleExport(); });
    data.timelineState.tracks[0].items[0].duration = 2;
    data.materials[0].url = '/api/storage/files/new.png';
    await act(async () => { ready.resolve(revision); await running!; });
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({
      total_duration: 1, required_cover: expect.objectContaining({ revision_id: 'r1' }),
      image_items: [expect.objectContaining({ duration: 1, url: revision.url })],
    }));
  });
  it('预检展示同一冻结摘要并同时收集建议，旧确认不能批准新时间轴', async () => {
    const data = fixture(); const ready = deferred<CoverRevision>();
    mocks.revision.mockReturnValueOnce(ready.promise);
    const onCoverCheck = vi.fn(); const onAdvisories = vi.fn();
    const collect = vi.fn(() => []);
    const { result } = renderHook(() => useVideoExport({ ...data, taskId: `t${task}`, projectId: 'p',
      preflight: { collect, onAdvisories, onCoverCheck } }));
    let running: Promise<void>;
    act(() => { running = result.current.handleExport(); });
    data.timelineState.tracks[0].name = 'new';
    await act(async () => { ready.resolve(revision); await running!; });
    const reviewedDigest = onCoverCheck.mock.calls[0][1];
    expect(JSON.parse(reviewedDigest).tracks[0].name).toBe('Cover');
    expect(onAdvisories).toHaveBeenCalledWith([]);
    await act(async () => { await result.current.handleExport({ skipAdvisories: true,
      reviewedCoverDigest: reviewedDigest }); });
    expect(onCoverCheck).toHaveBeenCalledTimes(2);
    expect(mocks.compose).not.toHaveBeenCalled();
  });
});
