import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AsyncTaskPoller } from '../AsyncTaskPoller';
import { resetVideoEditingStore, useVideoEditingStore } from '@/stores/videoEditingStore';
import * as api from '@/lib/api/arkVideo';
import { ApiError } from '@/lib/api/http-client';
import { translations } from '@/lib/i18n';

vi.mock('@/contexts/LocaleContext', () => ({ useLocale: () => ({ t: translations['zh-CN'], locale: 'zh-CN' }) }));

beforeEach(() => { vi.useFakeTimers(); resetVideoEditingStore(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
function addTask() {
  useVideoEditingStore.getState().addTask({ taskId: 'test', type: 'ai_video', status: 'pending', progress: 0,
    result: null, error: null, createdAt: Date.now(), metadata: { arkTaskId: 'native-1' } });
}
const ready: api.ArkVideoStatusResult = { status: 'succeeded', phase: 'ready', ark_task_id: 'native-1',
  video_url: '/api/storage/files/cached_materials/ark/native-1.mp4', duration: 5.08, width: 720, height: 1280 };

it('无缩略图 ready 一次入库，重挂载不重复', async () => {
  vi.spyOn(api, 'getArkVideoStatus').mockResolvedValue(ready);
  addTask();
  const view = render(<AsyncTaskPoller />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(useVideoEditingStore.getState().materials).toHaveLength(1);
  expect(useVideoEditingStore.getState().materials[0]).toMatchObject({ id: 'ai-vid-native-1', duration: 5.08, width: 720, height: 1280, cacheUrl: ready.video_url });
  view.unmount(); render(<AsyncTaskPoller />);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(useVideoEditingStore.getState().materials).toHaveLength(1);
});

it('永久鉴权错误只查询一次', async () => {
  const query = vi.spyOn(api, 'getArkVideoStatus').mockRejectedValue(new ApiError(502, 'provider_authentication', 'provider_authentication', { retryable: false }));
  addTask(); render(<AsyncTaskPoller />);
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(query).toHaveBeenCalledTimes(1);
  expect(useVideoEditingStore.getState().getTask('test')?.status).toBe('failed');
});

it('查询未返回时不重入，项目重置后丢弃迟到结果', async () => {
  let resolve!: (value: api.ArkVideoStatusResult) => void;
  const query = vi.spyOn(api, 'getArkVideoStatus').mockReturnValue(new Promise(done => { resolve = done; }));
  addTask(); render(<AsyncTaskPoller />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(query).toHaveBeenCalledTimes(1);
  resetVideoEditingStore();
  await act(async () => { resolve(ready); });
  expect(useVideoEditingStore.getState().materials).toHaveLength(0);
});

it('产物失败可见，明确点击重新收取只查询同一任务', async () => {
  const query = vi.spyOn(api, 'getArkVideoStatus').mockResolvedValue(ready);
  addTask();
  useVideoEditingStore.getState().updateTask('test', { status: 'failed', error: 'video_download_failed' });
  render(<AsyncTaskPoller />);
  expect(screen.getByRole('alert').textContent).toContain('下载');
  expect(query).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: translations['zh-CN'].integrations.videoGeneration.artifactRetry })); });
  expect(query.mock.calls[0]).toEqual(['native-1', expect.objectContaining({ retryArtifact: true })]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(useVideoEditingStore.getState().materials).toHaveLength(1);
  expect(useVideoEditingStore.getState().getTask('test')?.status).toBe('completed');
});

it('本地中断等待可显式重新查询同一任务，不会创建新任务', async () => {
  const query = vi.spyOn(api, 'getArkVideoStatus').mockResolvedValue(ready);
  addTask();
  useVideoEditingStore.getState().updateTask('test', { status: 'failed', error: 'video_wait_timeout' });
  render(<AsyncTaskPoller />);
  expect(query).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: translations['zh-CN'].integrations.videoGeneration.artifactRetry })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(useVideoEditingStore.getState().getTask('test')?.status).toBe('completed');
  expect(query.mock.calls.every(call => call[0] === 'native-1')).toBe(true);
});

it('十分钟期限会中止挂起的状态查询', async () => {
  const query = vi.spyOn(api, 'getArkVideoStatus').mockImplementation(() => new Promise(() => {}));
  addTask();
  render(<AsyncTaskPoller />);
  await act(async () => { await vi.advanceTimersByTimeAsync(600000); });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(useVideoEditingStore.getState().getTask('test')).toMatchObject({ status: 'failed', error: 'video_wait_timeout' });
});
