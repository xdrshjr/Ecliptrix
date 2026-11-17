import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEffectsDraftList } from '../useEffectsDraftList';
const api = vi.hoisted(() => ({ listEffectDraftPage: vi.fn() }));
vi.mock('@/lib/api/effects', () => api);
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());
const item = (id: string, version = 1) => ({ id, name: `${id}-${version}`, version });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
it('loads_next_draft_page_once', async () => {
  api.listEffectDraftPage.mockResolvedValueOnce({ items: [item('1')], nextCursor: 'opaque+page/2' });
  const page = deferred<{ items: ReturnType<typeof item>[] }>();
  api.listEffectDraftPage.mockReturnValueOnce(page.promise);
  const hook = renderHook(() => useEffectsDraftList('A', true));
  await waitFor(() => expect(hook.result.current.nextCursor).toBe('opaque+page/2'));
  act(() => { void hook.result.current.loadMore(); void hook.result.current.loadMore(); });
  await waitFor(() => expect(api.listEffectDraftPage).toHaveBeenCalledTimes(2));
  await act(async () => { page.resolve({ items: [item('1', 2), item('13')] }); });
  expect(hook.result.current.items.map(i => i.id)).toEqual(['1', '13']);
  expect(hook.result.current.items[0].version).toBe(2);
  expect(hook.result.current.nextCursor).toBeUndefined();
  api.listEffectDraftPage.mockResolvedValueOnce({ items: [item('1', 1)] });
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.items[0].version).toBe(2);
});
it('keeps_cursor_after_page_failure', async () => {
  api.listEffectDraftPage.mockResolvedValueOnce({ items: [item('1')], nextCursor: 'second' })
    .mockRejectedValueOnce(Error('503')).mockResolvedValueOnce({ items: [item('13')] });
  const hook = renderHook(() => useEffectsDraftList('A', true));
  await waitFor(() => expect(hook.result.current.nextCursor).toBe('second'));
  await act(async () => { await hook.result.current.loadMore(); });
  expect(hook.result.current.items).toEqual([item('1')]);
  expect(hook.result.current.errorPhase).toBe('load-more');
  expect(hook.result.current.nextCursor).toBe('second');
  await act(async () => { await hook.result.current.loadMore(); });
  expect(api.listEffectDraftPage.mock.calls[2][1]).toBe('second');
});
it('rejects_previous_project_page', async () => {
  const old = deferred<{ items: ReturnType<typeof item>[] }>();
  api.listEffectDraftPage.mockReturnValueOnce(old.promise).mockResolvedValue({ items: [item('new')] });
  const hook = renderHook(({ project }) => useEffectsDraftList(project, true), { initialProps: { project: 'A' } });
  hook.rerender({ project: 'B' }); hook.rerender({ project: 'A' });
  await waitFor(() => expect(hook.result.current.items).toEqual([item('new')]));
  await act(async () => { old.resolve({ items: [item('stale')] }); });
  expect(hook.result.current.items).toEqual([item('new')]);
});
it('invalidates_draft_pages_on_close', async () => {
  const old = deferred<{ items: ReturnType<typeof item>[] }>();
  api.listEffectDraftPage.mockReturnValue(old.promise);
  const hook = renderHook(({ active }) => useEffectsDraftList('A', active), { initialProps: { active: true } });
  await waitFor(() => expect(api.listEffectDraftPage).toHaveBeenCalledTimes(1));
  const signal = api.listEffectDraftPage.mock.calls[0][2].signal;
  hook.rerender({ active: false });
  expect(signal.aborted).toBe(true);
  await act(async () => { old.resolve({ items: [item('late')] }); });
  expect(hook.result.current.items).toEqual([]);
  expect(api.listEffectDraftPage).toHaveBeenCalledTimes(1);
});
it('刷新失败不接旧游标，迟到目录不覆盖已保存新摘要', async () => {
  api.listEffectDraftPage.mockResolvedValueOnce({ items: [item('1')], nextCursor: 'old' }).mockRejectedValueOnce(Error('503'));
  const hook = renderHook(() => useEffectsDraftList('A', true));
  await waitFor(() => expect(hook.result.current.nextCursor).toBe('old'));
  act(() => hook.result.current.upsertSummary(item('1', 3)));
  await act(async () => { await hook.result.current.refresh(); await hook.result.current.loadMore(); });
  expect(hook.result.current.items[0].version).toBe(3);
  expect(hook.result.current.nextCursor).toBeUndefined();
  expect(hook.result.current.errorPhase).toBe('first-page');
  expect(api.listEffectDraftPage).toHaveBeenCalledTimes(2);
});
