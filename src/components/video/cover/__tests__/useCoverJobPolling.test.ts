import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { videoCoverV2 } from '@/lib/api/videoCoverV2';
import type { CoverAsset, CoverJob } from '@/types/videoCover';
import { mergeCoverJobs, useCoverJobs } from '../useCoverJobs';

vi.mock('@/lib/api/videoCoverV2', () => ({ videoCoverV2: {
  getJob: vi.fn(), generate: vi.fn(),
} }));
const job = (jobId: string, status: CoverJob['status'] = 'queued'):
CoverJob => ({ jobId, status, baseVersion: 1, assets: [] });
const asset = (assetId: string): CoverAsset => ({ assetId,
  url: `/assets/${assetId}.png`, width: 1920, height: 1080, sha256: assetId });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done; reject = fail;
  });
  return { promise, resolve, reject };
}
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.mocked(videoCoverV2.getJob).mockImplementation(async (_id, id) =>
    job(id, 'running'));
});
afterEach(() => {
  cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('任务状态单调合并', () => {
  it('排队快照的异常下载阶段不能污染后续生成阶段', () => {
    const previous = { ...job('a'), phase: 'downloading' };
    const incoming = { ...job('a', 'running'), phase: 'generating' };
    expect(mergeCoverJobs([previous], [incoming])[0]).toMatchObject({
      status: 'running', phase: 'generating',
    });
  });
  it('迟到排队响应不能推进运行阶段但仍合并新候选', () => {
    const previous = { ...job('a', 'running'), phase: 'generating' };
    const incoming = { ...job('a'), phase: 'downloading',
      assets: [asset('new')] };
    expect(mergeCoverJobs([previous], [incoming])[0]).toMatchObject({
      status: 'running', phase: 'generating', assets: [asset('new')],
    });
  });
  it.each([undefined, 'unknown', 'queued', 'generating'])
  ('downloading之后收到%s阶段仍保留下载阶段和已有集合', phase => {
    const previous = { ...job('a', 'running'), phase: 'downloading',
      assets: [asset('first')], warnings: ['已有警告'] };
    const incoming = { ...job('a', 'running'), phase,
      assets: [asset('second')], warnings: ['新警告', '新警告'] };
    const merged = mergeCoverJobs([previous], [incoming]);
    expect(merged[0]).toMatchObject({ status: 'running', phase: 'downloading',
      assets: [asset('first'), asset('second')], warnings: ['已有警告', '新警告'] });
    expect(mergeCoverJobs(merged, [incoming])).toEqual(merged);
  });
  it.each(['queued', 'running'] as const)
  ('running收到%s仍合并候选与警告，重复ID使用传入元数据', status => {
    const previous = { ...job('a', 'running'), phase: 'downloading',
      assets: [asset('first'), asset('shared')], warnings: ['已有警告'] };
    const updated = { ...asset('shared'), url: '/assets/refreshed.png' };
    const incoming = { ...job('a', status), phase: 'queued',
      assets: [updated, asset('second')], warnings: ['已有警告', '新警告'] };
    const merged = mergeCoverJobs([previous], [incoming]);
    expect(merged[0]).toMatchObject({ status: 'running', phase: 'downloading',
      assets: [asset('first'), updated, asset('second')],
      warnings: ['已有警告', '新警告'] });
    expect(mergeCoverJobs(merged, [incoming])).toEqual(merged);
  });
  it.each([
    ['queued', 'generating', 'generating'],
    ['generating', 'downloading', 'downloading'],
    ['unknown', 'generating', 'generating'],
    ['generating', undefined, 'generating'],
  ])('活跃阶段从%s合并%s得到%s', (previous, incoming, expected) => {
    expect(mergeCoverJobs([{ ...job('a'), phase: previous }],
      [{ ...job('a', 'running'), phase: incoming }])[0].phase).toBe(expected);
  });
  it.each(['succeeded', 'failed', 'cancelled', 'interrupted'] as const)
  ('活跃进入%s采用服务端终态集合，同终态后续集合仍以服务端为准', status => {
    const previous = { ...job('a', 'running'), phase: 'downloading',
      assets: [asset('stale')], warnings: ['过期警告'] };
    const incoming = { ...job('a', status), phase: status,
      assets: [asset('final')], warnings: ['最终警告'] };
    const merged = mergeCoverJobs([previous], [incoming]);
    expect(merged[0]).toEqual(incoming);
    expect(mergeCoverJobs(merged, [{ ...incoming, assets: [], warnings: [] }])[0])
      .toEqual({ ...incoming, assets: [], warnings: [] });
    expect(mergeCoverJobs(merged, [previous])[0]).toBe(merged[0]);
  });
  it('取消终态和运行阶段都不能被旧快照回退', () => {
    const result = mergeCoverJobs([job('a', 'cancelled'), job('b', 'running')],
      [job('a', 'running'), job('b')]);
    expect(result.map(item => item.status)).toEqual(['cancelled', 'running']);
  });
  it('冲突终态保留已知值并记录诊断', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const previous = job('a', 'cancelled');
    expect(mergeCoverJobs([previous],
      [job('a', 'succeeded')])[0]).toBe(previous);
    expect(warning).toHaveBeenCalledOnce();
  });
  it('保留所有活动任务且仅将终态限制为20条', () => {
    const active = Array.from({ length: 25 }, (_, i) => job(`active-${i}`));
    const ended = Array.from({ length: 25 }, (_, i) =>
      job(`ended-${i}`, 'succeeded'));
    const merged = mergeCoverJobs(active, ended);
    expect(merged.filter(item => item.status === 'queued')).toHaveLength(25);
    expect(merged.filter(item => item.status === 'succeeded')).toHaveLength(20);
  });
});

describe('封面任务轮询调度', () => {
  it('空闲时没有计时器，新任务通过同一调度器唤醒', async () => {
    const hook = renderHook(() => useCoverJobs('project'));
    expect(vi.getTimerCount()).toBe(0);
    await advance(10000);
    act(() => hook.result.current.setJobs([job('a')]));
    expect(vi.getTimerCount()).toBe(1);
    await advance(1000);
    expect(hook.result.current.jobs[0].status).toBe('running');
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
  });
  it('单任务失败不阻止其他任务完成，也不会被其成功清除', async () => {
    const error = new Error('断网');
    vi.mocked(videoCoverV2.getJob).mockImplementation(async (_id, id) => {
      if (id === 'a') throw error;
      return job(id, 'succeeded');
    });
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.setJobs([job('a'), job('b')]));
    await advance(1000);
    expect(hook.result.current.jobs.find(item => item.jobId === 'b')?.status)
      .toBe('succeeded');
    expect(hook.result.current.jobs.find(item => item.jobId === 'a')?.status)
      .toBe('queued');
    expect(hook.result.current.connection).toEqual({ status: 'retrying',
      failedJobIds: ['a'], unavailableJobIds: [] });
    expect(hook.result.current.error).toBe(error);
    expect(videoCoverV2.generate).not.toHaveBeenCalled();
  });
  it('连续刷新在请求期间最多补一轮且无并发重复读取', async () => {
    const first = deferred<CoverJob>(); const second = deferred<CoverJob>();
    vi.mocked(videoCoverV2.getJob).mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.putJob(job('a')));
    act(() => {
      hook.result.current.refreshNow();
      hook.result.current.refreshNow();
      hook.result.current.refreshNow();
    });
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => first.resolve(job('a', 'running')));
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(job('a', 'succeeded')));
    expect(vi.getTimerCount()).toBe(0);
    await advance(10000);
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(2);
  });
  it('单任务退避为2/4/8/10秒，手动刷新立即恢复', async () => {
    vi.mocked(videoCoverV2.getJob).mockRejectedValue(new Error('断网'));
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.putJob(job('a')));
    await advance(1000);
    const delays = [2000, 4000, 8000, 10000];
    for (let index = 0; index < delays.length; index++) {
      const delay = delays[index];
      await advance(delay - 1);
      expect(videoCoverV2.getJob).toHaveBeenCalledTimes(index + 1);
      await advance(1);
      expect(videoCoverV2.getJob).toHaveBeenCalledTimes(index + 2);
    }
    vi.mocked(videoCoverV2.getJob).mockResolvedValue(job('a', 'succeeded'));
    await act(async () => hook.result.current.refreshNow());
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(6);
    expect(hook.result.current.connection.failedJobIds).toEqual([]);
    expect(hook.result.current.error).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('404只停止该任务自动读取，手动刷新仍可重新读取', async () => {
    vi.mocked(videoCoverV2.getJob).mockRejectedValue({ status: 404 });
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.putJob(job('a')));
    await advance(1000);
    expect(hook.result.current.jobs[0].status).toBe('queued');
    expect(hook.result.current.connection.unavailableJobIds).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0);
    await advance(30000);
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(1);
    vi.mocked(videoCoverV2.getJob).mockResolvedValue(job('a', 'succeeded'));
    await act(async () => hook.result.current.refreshNow());
    expect(hook.result.current.jobs[0].status).toBe('succeeded');
    expect(hook.result.current.connection.unavailableJobIds).toEqual([]);
  });
  it('取消响应清除连接错误，并拒绝迟到运行结果', async () => {
    vi.mocked(videoCoverV2.getJob).mockRejectedValueOnce(new Error('断网'));
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.putJob(job('a')));
    await advance(1000);
    const late = deferred<CoverJob>();
    vi.mocked(videoCoverV2.getJob).mockReturnValueOnce(late.promise);
    act(() => hook.result.current.refreshNow());
    act(() => hook.result.current.putJob(job('a', 'cancelled')));
    expect(hook.result.current.connection.failedJobIds).toEqual([]);
    expect(hook.result.current.error).toBeUndefined();
    await act(async () => late.resolve(job('a', 'running')));
    expect(hook.result.current.jobs[0].status).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('切项目和卸载中止请求，忽略不遵守abort的迟到结果', async () => {
    const late = deferred<CoverJob>();
    vi.mocked(videoCoverV2.getJob).mockReturnValueOnce(late.promise);
    const hook = renderHook(({ id }) => useCoverJobs(id),
      { initialProps: { id: 'first' } });
    act(() => hook.result.current.putJob(job('a')));
    await advance(1000);
    const signal = vi.mocked(videoCoverV2.getJob).mock.calls[0][2]!;
    hook.rerender({ id: 'second' });
    expect(signal.aborted).toBe(true);
    await act(async () => late.resolve(job('a', 'succeeded')));
    expect(hook.result.current.jobs).toEqual([]);
    act(() => hook.result.current.putJob(job('b')));
    hook.unmount(); await advance(10000);
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('后台任务以三秒间隔观察', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.putJob(job('a')));
    await advance(2999);
    expect(videoCoverV2.getJob).not.toHaveBeenCalled();
    await advance(1);
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(1);
    await advance(3000);
    expect(videoCoverV2.getJob).toHaveBeenCalledTimes(2);
  });
  it('失败任务独立退避，健康任务仍每秒更新且不清除其他错误',
    async () => {
      vi.mocked(videoCoverV2.getJob).mockImplementation(async (_id, id) => {
        if (id === 'a') throw new Error('断网');
        return job(id, 'running');
      });
      const hook = renderHook(() => useCoverJobs('project'));
      act(() => hook.result.current.setJobs([job('a'), job('b')]));
      await advance(5000);
      const calls = vi.mocked(videoCoverV2.getJob).mock.calls;
      expect(calls.filter(call => call[1] === 'a')).toHaveLength(2);
      expect(calls.filter(call => call[1] === 'b')).toHaveLength(5);
      expect(hook.result.current.connection.failedJobIds).toEqual(['a']);
    });
  it('移出20条展示的已知终态也不能被迟到快照重新激活', async () => {
    const hook = renderHook(() => useCoverJobs('project'));
    act(() => hook.result.current.putJob(job('old', 'cancelled')));
    act(() => hook.result.current.setJobs(Array.from({ length: 20 }, (_, i) =>
      job(`ended-${i}`, 'succeeded'))));
    expect(hook.result.current.jobs.some(item => item.jobId === 'old'))
      .toBe(false);
    act(() => hook.result.current.putJob(job('old', 'running')));
    expect(hook.result.current.jobs.find(item => item.jobId === 'old')?.status)
      .toBe('cancelled');
    await advance(30000);
    expect(videoCoverV2.getJob).not.toHaveBeenCalled();
  });
});
