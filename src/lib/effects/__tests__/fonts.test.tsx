import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createEffectDocument } from '../catalog';
import { loadEffectFont, useEffectFont } from '../fonts';
import { getEffectFontChain } from '../fontResources';
const handles = vi.hoisted(() => ({ delay: vi.fn(() => Math.random()),
  resume: vi.fn(), cancel: vi.fn() }));
vi.mock('remotion', () => ({ delayRender: handles.delay,
  continueRender: handles.resume, cancelRender: handles.cancel }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
function setup(load: () => Promise<unknown>) {
  const faces: { name: string; weight?: string }[] = [];
  vi.stubGlobal('FontFace', class {
    constructor(name: string, _source: string, options: { weight?: string }) { faces.push({ name, weight: options.weight }); }
    load = load;
  });
  Object.defineProperty(document, 'fonts', { configurable: true,
    value: { add: vi.fn() } });
  return faces;
}
it('同URL失败可重试，共享请求，字重属于缓存键', async () => {
  const load = vi.fn().mockRejectedValueOnce(Error('missing')).mockResolvedValue({});
  setup(load);
  await expect(loadEffectFont('retry', '/retry-font.ttf')).rejects.toThrow('EFFECT_FONT_LOAD_FAILED');
  await Promise.all([loadEffectFont('retry', '/retry-font.ttf'), loadEffectFont('retry', '/retry-font.ttf')]);
  expect(load).toHaveBeenCalledTimes(2);
  await loadEffectFont('retry', '/retry-font.ttf', '300 700');
  expect(load).toHaveBeenCalledTimes(3);
});
it('三种正文链等待emoji，加载描述符和CSS链一致', async () => {
  let release!: (font: unknown) => void;
  const pending = new Promise(done => { release = done; });
  const faces = setup(vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockReturnValueOnce(pending));
  const document = createEffectDocument(); document.typography.family = 'serif';
  const props = { document, assets: {}, fontUrls: { sans: '/chain-sans', serif: '/chain-serif', mono: '/chain-mono', emoji: '/chain-emoji' } };
  const hook = renderHook(() => useEffectFont(props));
  await act(async () => { await Promise.resolve(); });
  expect(hook.result.current).toBe(false);
  await act(async () => { release({}); });
  expect(hook.result.current).toBe(true);
  expect(faces).toEqual([{ name: 'Effects-serif', weight: '100 900' }, { name: 'Effects-sans', weight: '100 900' }, { name: 'Effects-emoji', weight: '300 700' }]);
  expect(getEffectFontChain('sans')).toBe('Effects-sans, Effects-emoji');
  expect(getEffectFontChain('mono')).toBe('Effects-mono, Effects-sans, Effects-emoji');
  hook.unmount(); expect(handles.resume.mock.calls.length).toBe(handles.delay.mock.calls.length);
});
it('Player失败交由React边界，卸载和迟到回包只释放一次', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setup(vi.fn().mockRejectedValue(Error('missing')));
  const props = { document: createEffectDocument(), assets: {}, fontUrls: { sans: '/failure', serif: '', mono: '', emoji: '/failure-emoji' } };
  const hook = renderHook(() => useEffectFont(props), { wrapper: Boundary });
  await waitFor(() => expect(handles.cancel).toHaveBeenCalled());
  hook.unmount();
  const released = handles.resume.mock.calls.map(call => call[0]);
  expect(new Set(released).size).toBe(released.length);
});
