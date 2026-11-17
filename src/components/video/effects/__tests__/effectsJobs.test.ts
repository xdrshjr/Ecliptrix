import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, RateLimitError } from '@/lib/api/http-client';
import type { EffectRenderJob } from '@/types/effects';
import { useEffectsJobs } from '../useEffectsJobs';
import { mergeEffectJob } from '../mergeEffectJob';
const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock('@/lib/api/effects', () => ({ listEffectJobs: api.list,
  getEffectJob: api.get, cancelEffectJob: api.cancel }));
const job = { id: 'new', projectId: 'p', status: 'queued', progress: 0,
  draftVersion: 1 } as EffectRenderJob;

beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue({ items: [] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('项目持久任务轮询', () => {
  it('晚到历史列表不覆盖刚提交的任务', async () => {
    let resolve!: (value: { items: EffectRenderJob[] }) => void;
    api.list.mockReturnValue(new Promise(done => { resolve = done; }));
    const { result, unmount } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    await act(async () => { resolve({ items: [] }); });
    expect(result.current.jobs.some(item => item.id === job.id)).toBe(true);
    unmount();
  });
  it('切换项目后拒绝旧任务注册和晚到列表', async () => {
    api.list.mockResolvedValue({ items: [] });
    const register = vi.fn();
    const { result, rerender, unmount } = renderHook(({ projectId }) =>
      useEffectsJobs({ projectId, onRegister: register }),
    { initialProps: { projectId: 'p' } });
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    rerender({ projectId: 'other' });
    act(() => result.current.watch({ ...job, status: 'succeeded',
      outputAsset: { projectId: 'p' } } as EffectRenderJob, true));
    expect(register).not.toHaveBeenCalled();
    unmount();
  });
  it('active列表失败不丢弃已成功的历史列表', async () => {
    api.list.mockImplementation((_project, _cursor, status) => status
      ? Promise.reject(new ApiError(503, 'EFFECT_RUNTIME_UNAVAILABLE', 'offline'))
      : Promise.resolve({ items: [{ ...job, status: 'succeeded' }] }));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    await act(async () => {});
    expect(result.current.jobs.map(item => item.id)).toEqual(['new']);
  });
  it('单坏任务不会丢弃其它本轮进度，也不会等挂起任务', async () => {
    vi.useFakeTimers();
    api.list.mockResolvedValue({ items: [] });
    api.get.mockImplementation((_project, id) => id === 'bad'
      ? Promise.reject(new ApiError(503, 'EFFECT_RUNTIME_UNAVAILABLE', 'offline'))
      : id === 'slow' ? new Promise(() => {})
      : Promise.resolve({ ...job, id, status: 'running', progress: 0.6 }));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => ['bad', 'good', 'slow'].forEach(id =>
      result.current.watch({ ...job, id })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.jobs.find(item => item.id === 'good')?.progress)
      .toBe(0.6);
  });
  it('连续watch超过五条active时仍最多五个GET在途', async () => {
    vi.useFakeTimers();
    api.get.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => Array.from({ length: 8 }, (_, index) => index.toString())
      .forEach(id => result.current.watch({ ...job, id })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.get).toHaveBeenCalledTimes(5);
  });
  it('404保留原卡片状态并停止自动查询，允许移除', async () => {
    vi.useFakeTimers();
    api.get.mockRejectedValue(new ApiError(404, 'EFFECT_NOT_FOUND', 'missing'));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.jobs[0].status).toBe('queued');
    expect(result.current.jobErrors.new.missing).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(api.get).toHaveBeenCalledTimes(1);
    act(() => result.current.removeMissing('new'));
    expect(result.current.jobs).toHaveLength(0);
  });
  it('404手动重查成功后接管真实任务', async () => {
    vi.useFakeTimers();
    api.get.mockRejectedValueOnce(new ApiError(404, 'EFFECT_NOT_FOUND', 'missing'))
      .mockResolvedValue({ ...job, status: 'succeeded' });
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await result.current.retry('new'); });
    expect(result.current.jobs[0].status).toBe('succeeded');
    expect(result.current.jobErrors.new).toBeUndefined();
  });
  it('取消立即使旧GET失效且重复取消不会重复请求', async () => {
    vi.useFakeTimers();
    let deliverGet!: (value: EffectRenderJob) => void;
    let deliverCancel!: (value: EffectRenderJob) => void;
    api.get.mockImplementation(() => new Promise(done => { deliverGet = done; }));
    api.cancel.mockImplementation(() => new Promise(done => { deliverCancel = done; }));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    let cancellation!: Promise<void>;
    await act(async () => {
      cancellation = result.current.cancel(job);
      await result.current.cancel(job);
    });
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.jobs[0].status).toBe('queued');
    await act(async () => {
      deliverCancel({ ...job, status: 'cancelled' }); await cancellation;
      deliverGet({ ...job, status: 'running', progress: 0.8 });
    });
    expect(result.current.jobs[0].status).toBe('cancelled');
  });
  it('取消失败保留卡片并恢复局部轮询', async () => {
    vi.useFakeTimers();
    api.cancel.mockRejectedValue(new ApiError(503, 'EFFECT_RUNTIME_UNAVAILABLE', 'offline'));
    api.get.mockResolvedValue({ ...job, status: 'running', progress: 0.4 });
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    await act(async () => { await result.current.cancel(job); });
    expect(result.current.jobs[0].status).toBe('queued');
    expect(result.current.cancelling.has('new')).toBe(false);
    expect(result.current.jobErrors.new.error.message).toBe('offline');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.jobs[0].status).toBe('running');
  });
  it('挂起GET在十秒独立超时释放且不伪造终态', async () => {
    vi.useFakeTimers();
    api.get.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
    expect(api.get.mock.calls[0][2].signal.aborted).toBe(true);
    expect(result.current.jobErrors.new.error.name).toBe('TimeoutError');
    expect(result.current.jobs[0].status).toBe('queued');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('429使用header和error_details较大退避值', async () => {
    vi.useFakeTimers();
    api.get.mockRejectedValue(new RateLimitError(2, 'limited',
      { retry_after_ms: 12000 }));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(11999); });
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('切到后台后既有前台timer也至少延后五秒', async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    api.get.mockResolvedValue({ ...job, status: 'running' });
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => result.current.watch(job));
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(api.get).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });
  it('翻页失败保留原cursor并同页重试合并去重', async () => {
    let fail = true;
    api.list.mockImplementation((_project, cursor, status) => {
      if (status) return Promise.resolve({ items: [] });
      if (!cursor) return Promise.resolve({ items: [{ ...job, status: 'succeeded' }],
        nextCursor: 'page-2' });
      if (fail) { fail = false; return Promise.reject(new Error('offline')); }
      return Promise.resolve({ items: [{ ...job, status: 'succeeded' },
        { ...job, id: 'older', status: 'failed' }], nextCursor: 'page-3' });
    });
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    await act(async () => {});
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.nextCursor).toBe('page-2');
    expect(result.current.listErrors.more?.message).toBe('offline');
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.nextCursor).toBe('page-3');
    expect(result.current.jobs.map(item => item.id)).toEqual(['new', 'older']);
    expect(api.list.mock.calls.filter(call => call[1] === 'page-2')).toHaveLength(2);
  });
  it('同项目重查列表后旧分页不能推进新cursor链', async () => {
    let deliver!: (page: { items: EffectRenderJob[]; nextCursor: string }) => void;
    let cursor = 'old';
    api.list.mockImplementation((_project, page, status) => status
      ? Promise.resolve({ items: [] }) : page
        ? new Promise(done => { deliver = done; })
        : Promise.resolve({ items: [], nextCursor: cursor }));
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    await act(async () => {});
    let more!: Promise<void>;
    await act(async () => { more = result.current.loadMore(); });
    cursor = 'new-chain';
    await act(async () => { await result.current.retryLists(); });
    await act(async () => { deliver({ items: [], nextCursor: 'stale' }); await more; });
    expect(result.current.nextCursor).toBe('new-chain');
    expect(result.current.loadingMore).toBe(false);
  });
  it('终态冲突保留首个结果并独立重新GET确认', async () => {
    vi.useFakeTimers();
    api.get.mockResolvedValue({ ...job, status: 'failed' });
    const { result } = renderHook(() => useEffectsJobs({
      projectId: 'p', onRegister: vi.fn() }));
    act(() => {
      result.current.watch({ ...job, status: 'failed' });
      result.current.watch({ ...job, status: 'succeeded' });
    });
    expect(result.current.jobs[0].status).toBe('failed');
    expect(result.current.jobErrors.new).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(result.current.jobErrors.new).toBeUndefined();
  });
  it('合并防止状态阶段与进度退回并补齐同终态成品', () => {
    const running = { ...job, status: 'running', phase: 'encoding',
      progress: 0.8 } as EffectRenderJob;
    const merged = mergeEffectJob(running, { ...running, phase: 'frames',
      progress: 0.2 }).job;
    expect([merged.phase, merged.progress]).toEqual(['encoding', 0.8]);
    const cancelling = { ...running, status: 'cancelling' } as EffectRenderJob;
    expect(mergeEffectJob(cancelling, running).job.status).toBe('cancelling');
    const terminal = { ...running, status: 'succeeded' } as EffectRenderJob;
    expect(mergeEffectJob(terminal, running).job.status).toBe('succeeded');
    const asset = { id: 'output', projectId: 'p' } as NonNullable<EffectRenderJob['outputAsset']>;
    const ready = mergeEffectJob(terminal, { ...terminal, outputAsset: asset }).job;
    expect([ready.phase, ready.progress, ready.outputAsset]).toEqual(['succeeded', 1, asset]);
    expect(mergeEffectJob(terminal, { ...terminal, projectId: 'other' }).error).toBeTruthy();
  });
});
