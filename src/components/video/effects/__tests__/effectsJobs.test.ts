import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectRenderJob } from '@/types/effects';
import { useEffectsJobs } from '../useEffectsJobs';
const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock('@/lib/api/effects', () => ({ listEffectJobs: api.list,
  getEffectJob: api.get, cancelEffectJob: api.cancel }));
const job = { id: 'new', projectId: 'p', status: 'queued', progress: 0,
  draftVersion: 1 } as EffectRenderJob;

beforeEach(() => { vi.clearAllMocks(); });
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
});
