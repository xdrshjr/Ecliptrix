import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryboardScriptSegment } from '@/types';
import { translations } from '@/lib/i18n';
import * as ark from '@/lib/api/arkVideo';
import * as storyboard from '@/lib/api/storyboard';
import { ApiError } from '@/lib/api/http-client';
import { useStoryboardScriptGeneration } from '../useStoryboardScriptGeneration';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'] }) }));
vi.mock('@/lib/credentialMissing', () => ({ reportCredentialMissing: vi.fn() }));
const ready: ark.ArkVideoStatusResult = {
  status: 'succeeded', phase: 'ready', ark_task_id: 'native-1',
  video_url: '/api/storage/files/cached_materials/ark/native-1.mp4',
  duration: 5.08, width: 720, height: 1280, model: 'video-model',
};
const initial: StoryboardScriptSegment = {
  id: 'scene', packId: 'pack', frameIndex: 0, frameUrl: '/frame.png',
  description: '水面涟漪', duration: 5, generationStatus: 'idle',
};
function setup(segment = initial) {
  const onAddMaterial = vi.fn();
  const hook = renderHook(({ projectId }) => {
    const [segments, setSegments] = useState([segment]);
    return { ...useStoryboardScriptGeneration({ segments, onUpdateSegments: setSegments, onAddMaterial, projectId }), segments };
  }, { initialProps: { projectId: 'project-1' } });
  return { ...hook, onAddMaterial };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storyboard, 'listPacks').mockResolvedValue([]);
  vi.spyOn(storyboard, 'batchGenerateVideos').mockResolvedValue({ taskGroups: [{ frameIndex: 0, taskIds: ['sbv-1', 'sbv-2'] }] });
  vi.spyOn(ark, 'getArkVideoStatus').mockImplementation(async id => ({ ...ready, ark_task_id: id === 'sbv-2' ? 'native-2' : 'native-1' }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('分镜视频完成契约', () => {
  it.each(['single', 'multiple', 'batch', 'batch-multiple'] as const)('%s 提交未返回 ID 时卸载再挂载原片段，退出等待且不重提', async branch => {
    let resolve!: (value: Awaited<ReturnType<typeof storyboard.batchGenerateVideos>>) => void;
    vi.mocked(storyboard.batchGenerateVideos).mockImplementation(() => new Promise(done => { resolve = done; }));
    const first = setup();
    let pending: unknown;
    await act(async () => {
      if (branch === 'single') pending = first.result.current.generateVideo('scene');
      else if (branch === 'multiple') pending = first.result.current.generateMultipleVideos('scene', 2);
      else pending = first.result.current.batchGenerateAllVideos(branch === 'batch' ? 1 : 2);
    });
    const snapshot = first.result.current.segments[0];
    expect(snapshot).toMatchObject({ generationStatus: 'queued', arkTaskId: undefined });
    first.unmount();
    const restored = setup(snapshot);
    expect(restored.result.current.segments[0]).toMatchObject({
      generationStatus: 'failed', generationProgress: 0, description: initial.description, frameUrl: initial.frameUrl,
      generationError: translations['zh-CN'].integrations.videoGeneration.submissionUnknown,
    });
    if (branch.includes('multiple')) expect(restored.result.current.segments[0].videoCandidates?.every(candidate => candidate.status === 'failed')).toBe(true);
    await act(async () => { resolve({ taskGroups: [{ frameIndex: 0, taskIds: ['sbv-1', 'sbv-2'] }] }); await pending; });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(storyboard.batchGenerateVideos).toHaveBeenCalledTimes(1);
    expect(ark.getArkVideoStatus).not.toHaveBeenCalled();
    expect(first.onAddMaterial).not.toHaveBeenCalled();
    expect(restored.onAddMaterial).not.toHaveBeenCalled();
  });

  it('恢复候选时已有 ID 继续查询，无 ID 候选独立标记受理未知', async () => {
    const restored = setup({ ...initial, generationStatus: 'queued', videoCandidates: [
      { id: 'known', arkTaskId: 'sbv-1', status: 'queued', progress: 0 },
      { id: 'unknown', arkTaskId: '', status: 'queued', progress: 0 },
    ] });
    expect(restored.result.current.segments[0].videoCandidates?.[1]).toMatchObject({
      status: 'failed', error: translations['zh-CN'].integrations.videoGeneration.submissionUnknown,
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(restored.result.current.segments[0].generationStatus).toBe('succeeded');
    expect(storyboard.batchGenerateVideos).not.toHaveBeenCalled();
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes(1);
    expect(restored.onAddMaterial).toHaveBeenCalledTimes(1);
  });

  it.each(['single', 'multiple', 'batch', 'batch-multiple'] as const)('%s 无缩略图完成一次，保留真实元数据和原生 ID', async branch => {
    const { result, onAddMaterial } = setup();
    await act(async () => {
      if (branch === 'single') await result.current.generateVideo('scene');
      else if (branch === 'multiple') await result.current.generateMultipleVideos('scene', 2);
      else await result.current.batchGenerateAllVideos(branch === 'batch' ? 1 : 2);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    const count = branch.includes('multiple') ? 2 : 1;
    expect(onAddMaterial).toHaveBeenCalledTimes(count);
    expect(onAddMaterial.mock.calls[0][0]).toMatchObject({ id: 'ai-vid-native-1', cacheUrl: ready.video_url,
      duration: 5.08, width: 720, height: 1280, metadata: { model: 'video-model' } });
    expect(result.current.segments[0]).toMatchObject({ generationStatus: 'succeeded',
      generatedVideoDuration: 5.08, generatedVideoWidth: 720, generatedVideoHeight: 1280, generatedVideoModel: 'video-model' });
    if (count === 2) expect(result.current.segments[0].videoCandidates?.[1]).toMatchObject({ duration: 5.08, width: 720, height: 1280 });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(onAddMaterial).toHaveBeenCalledTimes(count);
  });

  it('队列超时是终态，并终止轮询', async () => {
    vi.mocked(ark.getArkVideoStatus).mockResolvedValue({ status: 'timeout', error_code: 'video_task_expired' });
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(result.current.segments[0].generationStatus).toBe('timeout');
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes(1);
  });

  it('慢查询不重入，取消后丢弃响应', async () => {
    let resolve!: (value: ark.ArkVideoStatusResult) => void;
    vi.mocked(ark.getArkVideoStatus).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, onAddMaterial } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes(1);
    act(() => result.current.cancelGeneration('scene'));
    await act(async () => { resolve(ready); });
    expect(onAddMaterial).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'unmount', 'project'] as const)('%s 后丢弃创建任务迟到结果', async action => {
    let resolve!: (value: { taskGroups: { frameIndex: number; taskIds: string[] }[] }) => void;
    vi.mocked(storyboard.batchGenerateVideos).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, onAddMaterial, unmount, rerender } = setup();
    let pending: unknown;
    act(() => { pending = result.current.generateMultipleVideos('scene', 2); });
    if (action === 'cancel') act(() => result.current.cancelGeneration('scene'));
    else if (action === 'unmount') unmount();
    else rerender({ projectId: 'project-2' });
    await act(async () => { resolve({ taskGroups: [{ frameIndex: 0, taskIds: ['sbv-1', 'sbv-2'] }] }); await pending; });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(onAddMaterial).not.toHaveBeenCalled();
    expect(ark.getArkVideoStatus).not.toHaveBeenCalled();
  });

  it('按后端 YAML 期限停止挂起的查询', async () => {
    vi.mocked(storyboard.batchGenerateVideos).mockResolvedValue({ taskGroups: [{ frameIndex: 0, taskIds: ['sbv-1'] }], timeoutSeconds: 30 });
    vi.mocked(ark.getArkVideoStatus).mockImplementation(() => new Promise(() => {}));
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(result.current.segments[0]).toMatchObject({ generationStatus: 'timeout', generationTimeoutSeconds: 30 });
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes(1);
  });

  it('候选下载和验证阶段不入库', async () => {
    vi.mocked(ark.getArkVideoStatus).mockResolvedValue({ status: 'running', phase: 'validating' });
    const { result, onAddMaterial } = setup();
    await act(async () => { await result.current.generateMultipleVideos('scene', 2); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onAddMaterial).not.toHaveBeenCalled();
    expect(result.current.segments[0].generationProgress).toBe(95);
    vi.mocked(ark.getArkVideoStatus).mockImplementation(async id => ({ ...ready, ark_task_id: id === 'sbv-2' ? 'native-2' : 'native-1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onAddMaterial).toHaveBeenCalledTimes(2);
  });

  it.each([
    [new ApiError(502, 'provider_authentication', 'denied', { retryable: false }), 1],
    [new ApiError(429, 'provider_rate_limited', 'later', { retryable: true, retry_after_seconds: 120 }), 1],
    [new ApiError(502, 'video_status_unavailable', 'retry', { retryable: true }), 4],
  ])('候选按显式错误重试策略终止', async (error, expected) => {
    vi.mocked(ark.getArkVideoStatus).mockRejectedValue(error);
    const { result } = setup();
    await act(async () => { await result.current.generateMultipleVideos('scene', 2); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes((expected as number) * 2);
    expect(result.current.segments[0].generationStatus).toBe('failed');
  });

  it('已完成素材重挂载不重复入库', async () => {
    const { onAddMaterial } = setup({ ...initial, generationStatus: 'succeeded', arkTaskId: 'sbv-1', generatedVideoUrl: ready.video_url });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(onAddMaterial).not.toHaveBeenCalled();
    expect(ark.getArkVideoStatus).not.toHaveBeenCalled();
  });
});
