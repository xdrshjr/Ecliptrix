import React, { useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverDocument } from '@/types/videoCover';
import { CoverCanvas } from '../CoverCanvas';
import { createCoverDocument } from '../templates';
import { useCoverReadiness } from '../useCoverReadiness';

function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let latest: ReturnType<typeof useCoverReadiness>;
let layout = true;
let width = 100;
let observers: (() => void)[];
const decode = vi.fn<() => Promise<void>>(async () => undefined);
const box = () => ({ width: layout ? width : 0, height: layout ? 100 : 0,
  top: 0, left: 0, bottom: 100, right: width, x: 0, y: 0, toJSON() {} });
function Fixture({ doc, url, session = 'p:1', enabled = true, mounted = true }: {
  doc: CoverDocument | null; url?: string; session?: string;
  enabled?: boolean; mounted?: boolean;
}) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  latest = useCoverReadiness({ document: doc, backgroundUrl: url,
    readinessKey: session, canvasNode: node, enabled });
  return doc && mounted && <div ref={setNode}><CoverCanvas document={doc}
    backgroundUrl={latest.previewBackgroundUrl} imageLoadKey={latest.imageLoadKey} /></div>;
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(151); });
beforeEach(() => {
  vi.useFakeTimers(); layout = true; width = 100; observers = [];
  decode.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { observers.push(callback); }
    observe() {} disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => layout ? 100 : 0);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => layout ? 100 : 0);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(box);
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true,
    value: () => [box()] });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode });
  Object.defineProperty(document, 'fonts', { configurable: true,
    value: { ready: Promise.resolve(), addEventListener: vi.fn(), removeEventListener: vi.fn() } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  delete (document as unknown as { fonts?: unknown }).fonts;
});

describe('只读画面检查生命周期', () => {
  it('先保持checking，字体稳定后通过，布局变化不重新读取图片', async () => {
    const fonts = deferred(); Object.assign(document.fonts, { ready: fonts.promise });
    const doc = createCoverDocument({ mode: 'mixed', title: '标题' });
    doc.background = { ...doc.background, kind: 'asset', assetId: 'a' };
    render(<Fixture doc={doc} url="/api/storage/files/a.png" />);
    await settle(); expect(latest.result.status).toBe('checking');
    await act(async () => fonts.resolve());
    expect(latest.result.status).toBe('ready');
    await act(async () => { width = 120; observers.forEach(notify => notify());
      await vi.advanceTimersByTimeAsync(20); });
    expect(latest.result.status).toBe('ready'); expect(decode).toHaveBeenCalledOnce();
  });
  it('同背景失败后显式重试重建img和URL，不修改业务URL', async () => {
    decode.mockRejectedValueOnce(new Error('offline'));
    const doc = createCoverDocument({ mode: 'ai', title: '' });
    doc.background = { ...doc.background, kind: 'asset', assetId: 'a' };
    const view = render(<Fixture doc={doc} url="/api/storage/files/a.png?existing=1" />);
    await settle(); expect(latest.result.issues).toEqual([{ code: 'background-unreadable' }]);
    const oldImage = view.container.querySelector('img');
    await act(async () => latest.retry());
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(view.container.querySelector('img')).not.toBe(oldImage);
    expect(latest.previewBackgroundUrl).toBe('/api/storage/files/a.png?existing=1&cover_preview_retry=1');
    expect(latest.result.backgroundUrl).toBe('/api/storage/files/a.png?existing=1');
    expect(latest.result.status).toBe('ready');
  });
  it('A迟到解码错误不覆盖B，切会话同步撤销旧ready', async () => {
    const a = deferred(); decode.mockReturnValueOnce(a.promise);
    const doc = createCoverDocument({ mode: 'ai' });
    doc.background = { ...doc.background, kind: 'asset', assetId: 'a' };
    const view = render(<Fixture doc={doc} url="/api/storage/files/a.png" />);
    await settle();
    view.rerender(<Fixture doc={doc} url="/api/storage/files/b.png" />);
    await settle(); expect(latest.result.status).toBe('ready');
    await act(async () => a.reject(new Error('late')));
    expect(latest.result.status).toBe('ready');
    view.rerender(<Fixture doc={doc} url="/api/storage/files/b.png" session="p:2" />);
    expect(latest.result.status).toBe('checking');
    await settle(); expect(latest.result.status).toBe('ready');
  });
  it('首次文档挂载、设置返回均重新检查', async () => {
    const doc = createCoverDocument({ mode: 'html', title: '标题' });
    const view = render(<Fixture doc={null} enabled={false} />);
    view.rerender(<Fixture doc={doc} />); await settle();
    expect(latest.result.status).toBe('ready');
    view.rerender(<Fixture doc={doc} mounted={false} enabled={false} />);
    expect(latest.result.status).toBe('checking');
    view.rerender(<Fixture doc={doc} />); await settle();
    expect(latest.result.status).toBe('ready');
  });
  it('零布局撤销ready且恢复可测量时重新判断', async () => {
    render(<Fixture doc={createCoverDocument({ mode: 'html', title: '标题' })} />);
    await settle(); expect(latest.result.status).toBe('ready');
    await act(async () => { layout = false; observers.forEach(notify => notify()); });
    expect(latest.result.status).toBe('checking');
    await act(async () => { layout = true; observers.forEach(notify => notify());
      await vi.advanceTimersByTimeAsync(20); });
    expect(latest.result.status).toBe('ready');
  });
  it('字体和图片分别报告超时，AI跳过永不ready字体', async () => {
    Object.assign(document.fonts, { ready: new Promise(() => {}) });
    decode.mockImplementation(() => new Promise(() => {}));
    const doc = createCoverDocument({ mode: 'mixed', title: '标题' });
    doc.background = { ...doc.background, kind: 'asset', assetId: 'a' };
    const view = render(<Fixture doc={doc} url="/api/storage/files/a.png" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10151); });
    expect(latest.result.issues.map(i => i.code)).toEqual([
      'background-unreadable', 'font-unavailable',
    ]);
    decode.mockResolvedValue(undefined);
    view.rerender(<Fixture doc={{ ...doc, mode: 'ai' }} url="/api/storage/files/a.png" />);
    await settle(); expect(latest.result.status).toBe('ready');
  });
  it('结构问题不等待资源，连续编辑只检查最终输入，卸载清理计时器', async () => {
    const doc = createCoverDocument({ mode: 'html', title: '标题' });
    const view = render(<Fixture doc={doc} />);
    view.rerender(<Fixture doc={{ ...doc, fields: { title: '', subtitle: '', label: '' } }} />);
    expect(latest.result.issues).toEqual([{ code: 'content-empty' }]);
    view.rerender(<Fixture doc={doc} />);
    await settle(); expect(latest.result.status).toBe('ready');
    expect(decode).not.toHaveBeenCalled();
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
