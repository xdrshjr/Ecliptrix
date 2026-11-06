import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '@/lib/api/arkVideo';
import { resetVideoEditingStore, useVideoEditingStore } from '@/stores/videoEditingStore';
import { useMaterialGeneration } from '../useMaterialGeneration';
import type { MaterialItem } from '@/types';
import { useRef, useState } from 'react';

beforeEach(() => { vi.useFakeTimers(); resetVideoEditingStore(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function setup(initialMaterials: MaterialItem[] = []) {
  const succeeded = vi.fn();
  const failed = vi.fn();
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const hook = renderHook(() => {
    const [materials, setMaterials] = useState<MaterialItem[]>(initialMaterials);
    const materialsRef = useRef(materials);
    materialsRef.current = materials;
    const generation = useMaterialGeneration({ logger: logger as never,
      isMountedRef: { current: true }, setMaterials, materialsRef,
      addOrReplaceMaterial: vi.fn() });
    return { ...generation, materials, setMaterials };
  });
  return { ...hook, succeeded, failed };
}
const params = { prompt: '纸船', duration: 5, camera_fixed: false, watermark: false };

it('无缩略图 ready 替换占位，保留实测尺寸且只回调一次', async () => {
  vi.spyOn(api, 'createArkVideoTask').mockResolvedValue({ ark_task_id: 'native' });
  vi.spyOn(api, 'getArkVideoStatus').mockResolvedValue({ status: 'succeeded', phase: 'ready', ark_task_id: 'native', video_url: '/api/storage/files/video.mp4', duration: 5.08, width: 720, height: 1280 });
  const { result, succeeded, failed } = setup();
  await act(async () => { await result.current.handleAiVideoGenerate(params, { onSucceeded: succeeded, onFailed: failed }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(result.current.materials).toHaveLength(1);
  expect(result.current.materials[0]).toMatchObject({ id: 'ai-vid-native', duration: 5.08, cacheUrl: '/api/storage/files/video.mp4' });
  expect(succeeded).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
});

it('下载失败不会用远程地址伪造完成或留下转圈占位', async () => {
  vi.spyOn(api, 'createArkVideoTask').mockResolvedValue({ ark_task_id: 'native' });
  vi.spyOn(api, 'getArkVideoStatus').mockResolvedValue({ status: 'failed', error_code: 'video_download_failed' });
  const { result, succeeded, failed } = setup();
  await act(async () => { await result.current.handleAiVideoGenerate(params, { onSucceeded: succeeded, onFailed: failed }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(result.current.materials).toHaveLength(0);
  expect(succeeded).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith('video_download_failed');
});

it('删除占位后迟到成功不会触发导入回调', async () => {
  vi.spyOn(api, 'createArkVideoTask').mockResolvedValue({ ark_task_id: 'native' });
  let resolve!: (value: api.ArkVideoStatusResult) => void;
  vi.spyOn(api, 'getArkVideoStatus').mockImplementation(() => new Promise(r => { resolve = r; }));
  const { result, succeeded } = setup();
  await act(async () => { await result.current.handleAiVideoGenerate(params, { onSucceeded: succeeded }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  act(() => result.current.setMaterials([]));
  await act(async () => { resolve({ status: 'succeeded', phase: 'ready', video_url: '/api/storage/files/video.mp4', duration: 5, width: 1280, height: 720 }); });
  expect(succeeded).not.toHaveBeenCalled();
  expect(result.current.materials).toHaveLength(0);
  expect(useVideoEditingStore.getState().getActiveTasks()).toHaveLength(0);
});

it('逐句生成卸载重挂载后移除遗留占位，不自动再次收费', async () => {
  const create = vi.spyOn(api, 'createArkVideoTask').mockResolvedValue({ ark_task_id: 'native' });
  const first = setup();
  await act(async () => { await first.result.current.handleAiVideoGenerate(params, {
    metadataExtras: { source: 'narration-ai-video', linkedSentenceId: 'sentence' },
  }); });
  const placeholders = first.result.current.materials;
  first.unmount();
  const second = setup(placeholders);
  expect(second.result.current.materials).toHaveLength(0);
  expect(create).toHaveBeenCalledTimes(1);
});

it('提交未返回 ID 就卸载时明确受理未知，不接纳迟到 ID', async () => {
  let resolve!: (value: { ark_task_id: string }) => void;
  vi.spyOn(api, 'createArkVideoTask').mockImplementation(() => new Promise(done => { resolve = done; }));
  const first = setup();
  let request!: Promise<void>;
  act(() => { request = first.result.current.handleAiVideoGenerate(params); });
  first.unmount();
  expect(Object.values(useVideoEditingStore.getState().tasks)[0]).toMatchObject({
    status: 'failed', error: 'generation_submission_unknown',
  });
  await act(async () => { resolve({ ark_task_id: 'late' }); await request; });
  expect(Object.values(useVideoEditingStore.getState().tasks)[0].metadata.arkTaskId).toBeUndefined();
});

it('卸载后任务成为可见终态，迟到查询不回调也不导入', async () => {
  vi.spyOn(api, 'createArkVideoTask').mockResolvedValue({ ark_task_id: 'native' });
  let resolve!: (value: api.ArkVideoStatusResult) => void;
  const query = vi.spyOn(api, 'getArkVideoStatus').mockImplementation(() => new Promise(r => { resolve = r; }));
  const { result, succeeded, unmount } = setup();
  await act(async () => { await result.current.handleAiVideoGenerate(params, { onSucceeded: succeeded }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  unmount();
  expect(useVideoEditingStore.getState().getActiveTasks()).toHaveLength(0);
  expect(Object.values(useVideoEditingStore.getState().tasks)[0]).toMatchObject({
    status: 'failed', error: 'video_wait_timeout', metadata: { arkTaskId: 'native' },
  });
  expect(query.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => { resolve({ status: 'succeeded', phase: 'ready', video_url: '/api/storage/files/video.mp4' }); });
  expect(succeeded).not.toHaveBeenCalled();
});

it('提交期间切项目清空任务后不接受迟到任务 ID', async () => {
  let resolve!: (value: { ark_task_id: string }) => void;
  vi.spyOn(api, 'createArkVideoTask').mockImplementation(() => new Promise(r => { resolve = r; }));
  const status = vi.spyOn(api, 'getArkVideoStatus');
  const { result, succeeded } = setup();
  let request!: Promise<void>;
  act(() => { request = result.current.handleAiVideoGenerate(params, { onSucceeded: succeeded }); });
  resetVideoEditingStore();
  await act(async () => { resolve({ ark_task_id: 'late' }); await request; await vi.advanceTimersByTimeAsync(5000); });
  expect(status).not.toHaveBeenCalled();
  expect(succeeded).not.toHaveBeenCalled();
});
