import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AIVideoScriptSegment } from '@/types';
import { translations } from '@/lib/i18n';
import * as ark from '@/lib/api/arkVideo';
import { ApiError } from '@/lib/api/http-client';
import { useAIVideoScriptGeneration } from '../useAIVideoScriptGeneration';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'] }) }));
vi.mock('@/lib/credentialMissing', () => ({ reportCredentialMissing: vi.fn() }));
const ready: ark.ArkVideoStatusResult = {
  status: 'succeeded', phase: 'ready', ark_task_id: 'native-1',
  video_url: '/api/storage/files/cached_materials/ark/native-1.mp4',
  duration: 5.08, width: 720, height: 1280, model: 'video-model',
};
const initial: AIVideoScriptSegment = { id: 'scene', title: '纸船', scriptText: '水面涟漪', duration: 5, generationStatus: 'idle' };
const model: ark.VideoModelConfiguration = { configured: true, default_model: 'video-model', config_revision: 'revision-1',
  models: [{ id: 'video-model', display_name: 'model', profile: 'seedance_2', modes: ['description', 'keyframe', 'reference'],
    resolutions: ['720p'], duration_min: 4, duration_max: 12, max_reference_images: 4,
    supports_last_frame: true, supports_camera_fixed: false }] };

function setup(segment = initial) {
  const onAddMaterial = vi.fn();
  const hook = renderHook(({ projectKey }) => {
    const [segments, setSegments] = useState([segment]);
    return { ...useAIVideoScriptGeneration(segments, setSegments, onAddMaterial, projectKey), segments };
  }, { initialProps: { projectKey: 'project-1' } });
  return { ...hook, onAddMaterial };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(ark, 'createArkVideoTask').mockResolvedValue({ ark_task_id: 'native-1' });
  vi.spyOn(ark, 'getVideoModelConfiguration').mockResolvedValue(model);
  vi.spyOn(ark, 'getArkVideoStatus').mockResolvedValue(ready);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('逐句视频完成契约', () => {
  it('提交未返回 ID 时卸载再挂载原片段，退出等待并保留草稿', async () => {
    let resolve!: (value: ark.ArkVideoGenerateResult) => void;
    vi.mocked(ark.createArkVideoTask).mockImplementation(() => new Promise(done => { resolve = done; }));
    const first = setup();
    let pending!: Promise<void>;
    await act(async () => { pending = first.result.current.generateVideo('scene'); });
    expect(ark.createArkVideoTask).toHaveBeenCalledTimes(1);
    const snapshot = first.result.current.segments[0];
    expect(snapshot).toMatchObject({ generationStatus: 'generating', arkTaskId: undefined });
    first.unmount();
    const restored = setup(snapshot);
    expect(restored.result.current.segments[0]).toMatchObject({
      generationStatus: 'failed', generationProgress: 0, scriptText: initial.scriptText,
      generationError: translations['zh-CN'].integrations.videoGeneration.submissionUnknown,
    });
    await act(async () => { resolve({ ark_task_id: 'native-1' }); await pending; });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(ark.createArkVideoTask).toHaveBeenCalledTimes(1);
    expect(ark.getArkVideoStatus).not.toHaveBeenCalled();
    expect(first.onAddMaterial).not.toHaveBeenCalled();
    expect(restored.onAddMaterial).not.toHaveBeenCalled();
  });

  it('重新挂载已有任务 ID 时只恢复查询，不重提生成', async () => {
    const restored = setup({ ...initial, generationStatus: 'generating', arkTaskId: 'native-1' });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(restored.result.current.segments[0].generationStatus).toBe('succeeded');
    expect(ark.createArkVideoTask).not.toHaveBeenCalled();
    expect(restored.onAddMaterial).toHaveBeenCalledTimes(1);
  });

  it('无缩略图也立即完成，仅一次入库并保留真实尺寸', async () => {
    const { result, onAddMaterial } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.segments[0].generationStatus).toBe('succeeded');
    expect(onAddMaterial).toHaveBeenCalledTimes(1);
    expect(onAddMaterial.mock.calls[0][0]).toMatchObject({
      id: 'ai-vid-native-1', cacheUrl: ready.video_url, duration: 5.08,
      width: 720, height: 1280, metadata: { model: 'video-model' },
    });
    expect(ark.createArkVideoTask).toHaveBeenCalledWith(expect.objectContaining({ expected_config_revision: 'revision-1' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(onAddMaterial).toHaveBeenCalledTimes(1);
  });

  it('下载阶段不完成；请求未返回时不重入，取消后忽略迟到结果', async () => {
    let resolve!: (value: ark.ArkVideoStatusResult) => void;
    vi.mocked(ark.getArkVideoStatus).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, onAddMaterial } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes(1);
    act(() => result.current.cancelGeneration('scene'));
    await act(async () => { resolve(ready); });
    expect(onAddMaterial).not.toHaveBeenCalled();
    expect(result.current.segments[0].generationStatus).toBe('idle');
  });

  it('上游超时立即结束，不继续查询', async () => {
    vi.mocked(ark.getArkVideoStatus).mockResolvedValue({ status: 'timeout', error_code: 'video_task_expired' });
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(result.current.segments[0].generationStatus).toBe('failed');
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes(1);
  });

  it('卸载时丢弃在途结果', async () => {
    let resolve!: (value: ark.ArkVideoStatusResult) => void;
    vi.mocked(ark.getArkVideoStatus).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, onAddMaterial, unmount } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    unmount();
    await act(async () => { resolve(ready); });
    expect(onAddMaterial).not.toHaveBeenCalled();
  });

  it('十分钟期限终止正在等待的查询', async () => {
    vi.mocked(ark.getArkVideoStatus).mockImplementation(() => new Promise(() => {}));
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
    expect(result.current.segments[0].generationStatus).toBe('failed');
    expect(result.current.segments[0].generationError).toBe(translations['zh-CN'].integrations.videoGeneration.waitTimeout);
  });

  it('创建请求网络中断提示受理未知且不自动重发', async () => {
    vi.mocked(ark.createArkVideoTask).mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'network'));
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    expect(result.current.segments[0].generationError).toBe(translations['zh-CN'].integrations.videoGeneration.submissionUnknown);
    expect(ark.createArkVideoTask).toHaveBeenCalledTimes(1);
  });

  it('模型读取失败不提交、不提示受理未知', async () => {
    vi.mocked(ark.getVideoModelConfiguration).mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'network'));
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    expect(ark.createArkVideoTask).not.toHaveBeenCalled();
    expect(result.current.segments[0].generationError).not.toBe(translations['zh-CN'].integrations.videoGeneration.submissionUnknown);
  });

  it('配置竞争仅刷新目录，保留草稿且不自动重提', async () => {
    vi.mocked(ark.createArkVideoTask).mockRejectedValue(new ApiError(409, 'video_configuration_changed', 'changed'));
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    expect(ark.createArkVideoTask).toHaveBeenCalledTimes(1);
    expect(ark.getVideoModelConfiguration).toHaveBeenCalledTimes(2);
    expect(result.current.segments[0].scriptText).toBe(initial.scriptText);
    expect(result.current.segments[0].generationError).toBe(translations['zh-CN'].integrations.videoGeneration.configurationChanged);
  });

  it('不支持的已选图片不会被静默丢弃或提交', async () => {
    vi.mocked(ark.getVideoModelConfiguration).mockResolvedValue({ ...model, models: [{ ...model.models[0], profile: 'text_only', modes: ['description'] }] });
    const { result } = setup({ ...initial, characterImageUrl: '/api/storage/files/image.png' });
    await act(async () => { await result.current.generateVideo('scene'); });
    expect(ark.createArkVideoTask).not.toHaveBeenCalled();
    expect(result.current.segments[0].characterImageUrl).toBe('/api/storage/files/image.png');
  });

  it.each(['cancel', 'unmount', 'project'] as const)('%s 后创建响应不启动轮询', async action => {
    let resolve!: (value: ark.ArkVideoGenerateResult) => void;
    vi.mocked(ark.createArkVideoTask).mockImplementation(() => new Promise(done => { resolve = done; }));
    const { result, onAddMaterial, unmount, rerender } = setup();
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.generateVideo('scene'); });
    if (action === 'cancel') act(() => result.current.cancelGeneration('scene'));
    else if (action === 'unmount') unmount();
    else rerender({ projectKey: 'project-2' });
    await act(async () => { resolve({ ark_task_id: 'native-1' }); await pending; });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(onAddMaterial).not.toHaveBeenCalled();
    expect(ark.getArkVideoStatus).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(502, 'provider_authentication', 'denied', { retryable: false }), 1],
    [new ApiError(429, 'provider_rate_limited', 'later', { retryable: true, retry_after_seconds: 120 }), 1],
    [new ApiError(502, 'video_status_unavailable', 'retry', { retryable: true }), 4],
  ])('查询错误按显式策略结束', async (error, expected) => {
    vi.mocked(ark.getArkVideoStatus).mockRejectedValue(error);
    const { result } = setup();
    await act(async () => { await result.current.generateVideo('scene'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(ark.getArkVideoStatus).toHaveBeenCalledTimes(expected as number);
    expect(result.current.segments[0].generationStatus).toBe('failed');
  });
});
