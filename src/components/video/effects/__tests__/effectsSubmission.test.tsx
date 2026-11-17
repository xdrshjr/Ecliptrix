import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/http-client';
import { readPending } from '@/lib/effects/pendingWrites';
import { useEffectsSubmission } from '../useEffectsSubmission';
const api = vi.hoisted(() => ({ submit: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/api/effects', () => ({ submitEffectJob: api.submit,
  getEffectJobByRequest: api.get }));
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (_name: string, _options: unknown,
      callback: (lock: object) => unknown) => callback({}),
  } });
});
afterEach(cleanup);
const request = { draftId: '0e931a68-f0a1-4abd-b530-23a377620ce7',
  expectedVersion: 1 };
it('丢全部回包后刷新仍先查询原键，404才同体重发', async () => {
  api.submit.mockRejectedValue(new Error('lost'));
  const first = renderHook(() => useEffectsSubmission({ projectId: 'p',
    canWrite: () => true, watch: vi.fn() }));
  await act(async () => { await first.result.current.submit(request); });
  const original = api.submit.mock.calls[0][0];
  expect(first.result.current.state).toBe('uncertain');
  first.unmount();
  api.get.mockRejectedValue(new ApiError(404, 'EFFECT_NOT_FOUND', 'missing'));
  const watch = vi.fn();
  api.submit.mockResolvedValue({ ...original, id: 'job',
    draftVersion: 1, status: 'queued' });
  const second = renderHook(() => useEffectsSubmission({ projectId: 'p',
    canWrite: () => true, watch }));
  await act(async () => { await second.result.current.recover(); });
  expect(api.submit.mock.calls[1][0]).toEqual(original);
  expect(watch).toHaveBeenCalledOnce();
  expect((await readPending('p', 'submission')).record).toBeUndefined();
});
it('本地存储失败不POST，租约失效不续写', async () => {
  const failure = vi.spyOn(localStorage, 'setItem')
    .mockImplementation(() => { throw new Error('quota'); });
  const hook = renderHook(() => useEffectsSubmission({ projectId: 'p',
    canWrite: () => true, watch: vi.fn() }));
  await act(async () => { await hook.result.current.submit(request); });
  expect(api.submit).not.toHaveBeenCalled(); failure.mockRestore();
  expect(hook.result.current.error?.message).toBe('EFFECT_LOCAL_STATE_UNAVAILABLE');
});
it('跨项目晚到回包不交付，也不清原项目恢复记录', async () => {
  let release!: (job: unknown) => void;
  api.submit.mockImplementation(() => new Promise(done => { release = done; }));
  const watch = vi.fn();
  const hook = renderHook(({ projectId }) => useEffectsSubmission({ projectId,
    canWrite: () => true, watch }), { initialProps: { projectId: 'p' } });
  let pending!: Promise<void>;
  await act(async () => { pending = hook.result.current.submit(request); });
  hook.rerender({ projectId: 'q' });
  await act(async () => { release({ ...api.submit.mock.calls[0][0],
    id: 'job', draftVersion: 1, status: 'queued' }); await pending; });
  expect(watch).not.toHaveBeenCalled();
  expect((await readPending('p', 'submission')).record).toBeTruthy();
});
it('同项目租约释放再取得新租约，旧回包仅可watch，不写新编辑记录', async () => {
  let release!: (job: unknown) => void;
  api.submit.mockImplementation(() => new Promise(done => { release = done; }));
  let editorEpoch = 1;
  const watch = vi.fn();
  const hook = renderHook(() => useEffectsSubmission({ projectId: 'p',
    getEditorEpoch: () => editorEpoch, canWrite: () => true, watch }));
  let pending!: Promise<void>;
  await act(async () => { pending = hook.result.current.submit(request); });
  editorEpoch++;
  await act(async () => { release({ ...api.submit.mock.calls[0][0],
    id: 'job', draftVersion: 1, status: 'queued' }); await pending; });
  expect(watch).toHaveBeenCalledOnce();
  expect((await readPending('p', 'submission')).record?.state).toBe('submitting');
});
