import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createEffectDocument } from '../catalog';
import { useEffectFont } from '../fonts';
const handles = vi.hoisted(() => ({ delay: vi.fn(() => Math.random()),
  resume: vi.fn(), cancel: vi.fn() }));
vi.mock('remotion', () => ({ delayRender: handles.delay,
  continueRender: handles.resume, cancelRender: handles.cancel }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('同 URL 失败后可以显式重挂载重试，并发者共享请求且都释放句柄', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('missing font'))
    .mockResolvedValue({ family: 'Effects-sans' });
  vi.stubGlobal('FontFace', class { load = load; });
  Object.defineProperty(document, 'fonts', { configurable: true,
    value: { add: vi.fn() } });
  const props = { document: createEffectDocument(), assets: {},
    fontUrls: { sans: '/retry-font.ttf', serif: '', mono: '' } };
  const first = renderHook(() => useEffectFont(props));
  await waitFor(() => expect(handles.cancel).toHaveBeenCalledOnce());
  expect((handles.cancel.mock.calls as unknown[][])[0][0])
    .toMatchObject({ message: 'EFFECT_FONT_LOAD_FAILED' });
  first.unmount();
  const second = renderHook(() => useEffectFont(props));
  const third = renderHook(() => useEffectFont(props));
  await act(async () => { await Promise.resolve(); });
  expect(second.result.current).toBe(true);
  expect(third.result.current).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
  expect(handles.resume).toHaveBeenCalledTimes(3);
});
