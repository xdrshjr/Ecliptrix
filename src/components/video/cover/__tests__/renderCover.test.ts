import React, { createRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));
import { toBlob } from 'html-to-image';
import { createCoverRenderScope, renderCover } from '../renderCover';
import { CoverRenderHost, type CoverRenderHostRef } from '../CoverRenderHost';
import { createCoverDocument } from '../templates';
import type { CoverDocument } from '@/types/videoCover';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const png = () => new Blob(['png'], { type: 'image/png' });
const size = { width: 1920, height: 1080 };
const localUrl = '/api/storage/files/images/cover.png';
const rect = (width = 100, height = 20) => ({ x: 0, y: 0, top: 0,
  right: width, bottom: height, left: 0, width, height, toJSON() {} });
function fonts(promise: Promise<unknown>, owner = document) {
  Object.defineProperty(owner, 'fonts', { configurable: true,
    value: { ready: promise } });
}
function documentFor(mode: CoverDocument['mode'] = 'html') {
  const doc = createCoverDocument({ mode, title: '真实封面' });
  if (mode !== 'html') doc.background = { ...doc.background,
    kind: 'asset', assetId: 'asset' };
  return doc;
}
function canvas(mode = 'html', owner = document) {
  const node = owner.createElement('div');
  node.dataset.coverCanvas = ''; node.dataset.coverMode = mode;
  node.style.width = '1920px'; node.style.height = '1080px';
  if (mode !== 'ai') for (const field of ['title', 'subtitle', 'label']) {
    const text = owner.createElement('div');
    text.dataset.coverText = field; text.dataset.initial = '40';
    text.dataset.minimum = '20'; text.dataset.lines = '3';
    text.style.width = '800px'; text.style.height = '300px';
    text.textContent = field; node.append(text);
  }
  owner.body.append(node);
  return node;
}
function host() {
  const ref = createRef<CoverRenderHostRef>();
  const view = render(React.createElement(CoverRenderHost,
    { projectId: 'project', ref }));
  return { ref, ...view };
}
function request(ref: React.RefObject<CoverRenderHostRef | null>,
  doc = documentFor(), url?: string) {
  let task!: Promise<Blob>;
  act(() => { task = ref.current!.render(doc, url); });
  void task.catch(() => undefined);
  return task;
}
async function settle() { await act(async () => {}); }
async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers(); fonts(Promise.resolve());
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return parseFloat(this.style.width) || 100;
    });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return parseFloat(this.style.height) || 100;
    });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return rect(this.clientWidth, this.clientHeight);
    });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => [rect()] as unknown as DOMRectList;
    return range;
  });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, value: vi.fn().mockResolvedValue(undefined),
  });
  vi.mocked(toBlob).mockReset().mockResolvedValue(png());
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ ...size, close: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
    blob: async () => png() })));
  URL.createObjectURL = vi.fn(() => 'blob:cover');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup(); document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('封面精确渲染门禁', () => {
  it('失效 scope 仍消费已经开始的工作拒绝', async () => {
    const scope = createCoverRenderScope(); scope.dispose();
    const work = Promise.reject(new Error('late operation'));
    await expect(scope.wait(work)).rejects.toMatchObject({ name: 'AbortError' });
    await tick(1);
  });
  it('调用方取消优先且不开始渲染', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(renderCover(canvas(), { ...size, signal: abort.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(toBlob).not.toHaveBeenCalled();
  });
  it('普通空 Blob 故障最多尝试两次', async () => {
    vi.mocked(toBlob).mockResolvedValue(null);
    await expect(renderCover(canvas(), size)).rejects.toThrow('COVER_RENDER_FAILED');
    expect(toBlob).toHaveBeenCalledTimes(2);
  });
  it('一次普通故障后可成功且固定尺寸', async () => {
    vi.mocked(toBlob).mockRejectedValueOnce(new Error('temporary'));
    await expect(renderCover(canvas(), size)).resolves.toBeInstanceOf(Blob);
    expect(toBlob).toHaveBeenCalledTimes(2);
    expect(toBlob).toHaveBeenLastCalledWith(expect.any(HTMLElement),
      expect.objectContaining({ ...size, canvasWidth: 1920,
        canvasHeight: 1080, pixelRatio: 1, skipFonts: true }));
  });
  it('不可测量 DOM 不视为通过且不开始 toBlob', async () => {
    const node = canvas(); node.remove();
    await expect(renderCover(node, size)).rejects.toThrow('COVER_RENDER_FAILED');
    expect(toBlob).not.toHaveBeenCalled();
  });
  it.each(['missing-field', 'zero-size', 'no-range'])(
    '布局未就绪 %s 不会截图', async cause => {
      const node = canvas();
      if (cause === 'missing-field') node.firstElementChild!.remove();
      else if (cause === 'zero-size') {
        vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect(0, 0));
      } else vi.mocked(document.createRange).mockImplementation(() => ({
        selectNodeContents() {}, getClientRects: () => [],
      }) as unknown as Range);
      await expect(renderCover(node, size)).rejects.toThrow('COVER_RENDER_FAILED');
      expect(toBlob).not.toHaveBeenCalled();
    });
  it('字段溢出报告专用错误且不重试截图', async () => {
    const node = canvas();
    Object.defineProperty(node.querySelector('[data-cover-text]'),
      'scrollWidth', { value: 9999 });
    await expect(renderCover(node, size)).rejects.toThrow('COVER_TEXT_OVERFLOW');
    expect(toBlob).not.toHaveBeenCalled();
  });
  it('字体拒绝按字体错误处理', async () => {
    const font = deferred<unknown>(); fonts(font.promise);
    const assertion = expect(renderCover(canvas(), size))
      .rejects.toThrow('COVER_FONT_UNAVAILABLE');
    font.reject(new Error('font failed')); await assertion;
    expect(toBlob).not.toHaveBeenCalled();
  });
  it('图片解码拒绝按背景错误处理', async () => {
    const node = canvas(); node.append(document.createElement('img'));
    vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValue(new Error('image'));
    await expect(renderCover(node, size)).rejects.toThrow('COVER_BACKGROUND_UNREADABLE');
    expect(toBlob).not.toHaveBeenCalled();
  });
  it('字体与图片独立同时开始，图片超时不归为字体错误', async () => {
    const font = deferred<unknown>(); fonts(font.promise);
    const node = canvas(); node.append(document.createElement('img'));
    vi.mocked(HTMLImageElement.prototype.decode).mockReturnValue(new Promise(() => {}));
    const assertion = expect(renderCover(node, size))
      .rejects.toThrow('COVER_BACKGROUND_UNREADABLE');
    await tick(9000); font.resolve(undefined); await tick(1000); await assertion;
  });
  it('字体十秒截止有独立错误码', async () => {
    fonts(new Promise(() => {}));
    const assertion = expect(renderCover(canvas(), size))
      .rejects.toThrow('COVER_FONT_UNAVAILABLE');
    await tick(10000); await assertion;
  });
  it('AI 在字体永不完成时仍检查图片并完成渲染', async () => {
    fonts(new Promise(() => {}));
    const node = canvas('ai'); node.append(document.createElement('img'));
    const assertion = expect(renderCover(node, size)).resolves.toBeInstanceOf(Blob);
    await tick(10000); await assertion;
    expect(HTMLImageElement.prototype.decode).toHaveBeenCalledOnce();
  });
  it('使用画布所属文档的字体', async () => {
    fonts(new Promise(() => {}));
    const owner = document.implementation.createHTMLDocument();
    fonts(Promise.resolve(), owner);
    vi.spyOn(owner, 'createRange').mockImplementation(() => document.createRange());
    const assertion = expect(renderCover(canvas('html', owner), size))
      .resolves.toBeInstanceOf(Blob);
    await tick(10000); await assertion;
  });
  it.each(['resolve', 'reject'] as const)(
    '十五秒后 toBlob 迟到 %s 不创建 bitmap 或重试', async outcome => {
      const late = deferred<Blob | null>(); vi.mocked(toBlob).mockReturnValue(late.promise);
      const assertion = expect(renderCover(canvas(), size)).rejects.toThrow('COVER_RENDER_FAILED');
      await tick(15000); await assertion;
      if (outcome === 'resolve') late.resolve(png()); else late.reject(new Error('late'));
      await settle();
      expect(toBlob).toHaveBeenCalledTimes(1);
      expect(createImageBitmap).not.toHaveBeenCalled();
    });
  it('已开始的 bitmap 即使截止后才返回也最终释放', async () => {
    const late = deferred<ImageBitmap>(); const close = vi.fn();
    vi.mocked(createImageBitmap).mockReturnValue(late.promise);
    const assertion = expect(renderCover(canvas(), size)).rejects.toThrow('COVER_RENDER_FAILED');
    await tick(15000); await assertion;
    late.resolve({ ...size, close } as unknown as ImageBitmap); await settle();
    expect(close).toHaveBeenCalledOnce(); expect(toBlob).toHaveBeenCalledOnce();
  });
  it('尺寸错误的 bitmap 每次都会释放且总共仅两次尝试', async () => {
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValue({ width: 1, height: 1,
      close } as unknown as ImageBitmap);
    await expect(renderCover(canvas(), size)).rejects.toThrow('COVER_RENDER_FAILED');
    expect(close).toHaveBeenCalledTimes(2);
    expect(toBlob).toHaveBeenCalledTimes(2);
  });
  it('定时器尚未执行也按绝对截止阻止重试', async () => {
    vi.mocked(toBlob).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 15001); throw new Error('late');
    });
    await expect(renderCover(canvas(), size)).rejects.toThrow('COVER_RENDER_FAILED');
    expect(toBlob).toHaveBeenCalledOnce();
  });
  it('截图同步触发取消时仍消费其已返回的拒绝 Promise', async () => {
    const abort = new AbortController();
    vi.mocked(toBlob).mockImplementation(() => {
      abort.abort(); return Promise.reject(new Error('cancelled screenshot'));
    });
    await expect(renderCover(canvas(), { ...size, signal: abort.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    await settle(); expect(toBlob).toHaveBeenCalledOnce();
  });
  it('截图期间取消保留 AbortError 并消费迟到失败', async () => {
    const late = deferred<Blob | null>(); const abort = new AbortController();
    vi.mocked(toBlob).mockReturnValue(late.promise);
    const assertion = expect(renderCover(canvas(), { ...size, signal: abort.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    await settle(); abort.abort(); await assertion;
    late.reject(new Error('late')); await settle();
    expect(toBlob).toHaveBeenCalledOnce();
  });
});

describe('实际挂载的 CoverRenderHost', () => {
  it('使用业务 URL 校验并重新读取，内部 blob 只用于渲染', async () => {
    const { ref } = host(); const doc = documentFor('mixed');
    const original = structuredClone(doc);
    const task = request(ref, doc, localUrl); await settle();
    await expect(task).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledWith(localUrl,
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(doc).toEqual(original);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover');
  });
  it.each([404, 410, 403, 500])('HTTP %s 分类稳定', async status => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status } as Response);
    const { ref } = host(); const task = request(ref, documentFor('mixed'), localUrl);
    await settle();
    await expect(task).rejects.toThrow([404, 410].includes(status)
      ? 'COVER_ASSET_MISSING' : 'COVER_BACKGROUND_UNREADABLE');
    expect(toBlob).not.toHaveBeenCalled();
  });
  it.each(['fetch', 'body'])('%s 拒绝归类背景不可读', async stage => {
    if (stage === 'fetch') vi.mocked(fetch).mockRejectedValue(new Error('network'));
    else vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200,
      blob: async () => { throw new Error('body'); } } as unknown as Response);
    const { ref } = host(); const task = request(ref, documentFor('mixed'), localUrl);
    await settle(); await expect(task).rejects.toThrow('COVER_BACKGROUND_UNREADABLE');
  });
  it.each(['fetch', 'body'])('%s 局部十秒截止归类背景不可读', async stage => {
    if (stage === 'fetch') vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    else vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200,
      blob: () => new Promise(() => {}) } as Response);
    const { ref } = host(); const task = request(ref, documentFor('mixed'), localUrl);
    await tick(10000); await expect(task).rejects.toThrow('COVER_BACKGROUND_UNREADABLE');
  });
  it('fetch 与 body 共享十五秒总截止，body 迟到不创建 URL', async () => {
    const response = deferred<Response>(); const body = deferred<Blob>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const { ref } = host(); const task = request(ref, documentFor('mixed'), localUrl);
    await tick(9000); response.resolve({ ok: true, status: 200,
      blob: () => body.promise } as Response);
    await tick(6000); await expect(task).rejects.toThrow('COVER_RENDER_FAILED');
    body.resolve(png()); await settle();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(toBlob).not.toHaveBeenCalled();
  });
  it('读取用掉九秒后截图只剩六秒，截止立即撤销本次 URL', async () => {
    const response = deferred<Response>(); const screenshot = deferred<Blob | null>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    vi.mocked(toBlob).mockReturnValue(screenshot.promise);
    const { ref } = host(); const task = request(ref, documentFor('mixed'), localUrl);
    await tick(9000); response.resolve({ ok: true, status: 200,
      blob: async () => png() } as Response);
    await tick(6000); await expect(task).rejects.toThrow('COVER_RENDER_FAILED');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    screenshot.resolve(png()); await settle();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it.each([undefined, 'https://remote/cover.png', 'blob:preview'])
    ('拒绝非法业务 URL %s', async url => {
      const { ref } = host(); const task = request(ref, documentFor('mixed'), url);
      await settle(); await expect(task).rejects.toThrow('COVER_ASSET_MISSING');
      expect(fetch).not.toHaveBeenCalled();
    });
  it.each(['empty', 'background'])(
    '结构缺陷 %s 在读取和截图前拒绝', async kind => {
      const doc = documentFor();
      if (kind === 'empty') doc.fields.title = ' ';
      else doc.mode = 'mixed';
      const { ref } = host(); const task = request(ref, doc);
      await settle(); await expect(task).rejects.toThrow('COVER_DRAFT_NOT_READY');
      expect(fetch).not.toHaveBeenCalled(); expect(toBlob).not.toHaveBeenCalled();
    });
  it('同快照去重，入队后文档改变不会更改渲染快照', async () => {
    const late = deferred<Blob | null>(); vi.mocked(toBlob).mockReturnValue(late.promise);
    const { ref } = host(); const doc = documentFor();
    const first = request(ref, doc); const duplicate = request(ref, doc);
    doc.fields.title = '后来修改'; await settle();
    expect(first).toBe(duplicate);
    expect(vi.mocked(toBlob).mock.calls[0][0].textContent).toContain('真实封面');
    late.resolve(png()); await settle(); await first;
  });
  it.each(['resolve', 'reject'] as const)(
    '超时后下一请求使用独立 DOM，旧截图迟到 %s 不影响新请求', async outcome => {
      const late = deferred<Blob | null>(); const next = deferred<Blob | null>();
      vi.mocked(toBlob).mockReturnValueOnce(late.promise).mockReturnValueOnce(next.promise);
      const { ref } = host(); const first = request(ref);
      const doc = documentFor(); doc.fields.title = '下一张';
      const second = request(ref, doc);
      await settle(); expect(toBlob).toHaveBeenCalledTimes(1);
      const oldNode = vi.mocked(toBlob).mock.calls[0][0];
      await tick(15000); await expect(first).rejects.toThrow('COVER_RENDER_FAILED');
      expect(toBlob).toHaveBeenCalledTimes(2);
      const newNode = vi.mocked(toBlob).mock.calls[1][0];
      expect(newNode).not.toBe(oldNode); expect(oldNode.isConnected).toBe(false);
      expect(newNode.isConnected).toBe(true);
      if (outcome === 'resolve') late.resolve(png()); else late.reject(new Error('late'));
      await settle(); expect(createImageBitmap).not.toHaveBeenCalled();
      expect(newNode.isConnected).toBe(true);
      next.resolve(png()); await settle(); await expect(second).resolves.toBeInstanceOf(Blob);
      expect(toBlob).toHaveBeenCalledTimes(2);
    });
  it('同键跨会话取消与迟到清理不会删除新 pending 或新 DOM', async () => {
    const late = deferred<Blob | null>(); const next = deferred<Blob | null>();
    vi.mocked(toBlob).mockReturnValueOnce(late.promise).mockReturnValueOnce(next.promise);
    const { ref, rerender } = host(); const first = request(ref); await settle();
    rerender(React.createElement(CoverRenderHost, { projectId: 'other', ref }));
    rerender(React.createElement(CoverRenderHost, { projectId: 'project', ref }));
    const second = request(ref); await settle();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const current = vi.mocked(toBlob).mock.calls[1][0];
    late.resolve(png()); await settle();
    expect(request(ref)).toBe(second); expect(current.isConnected).toBe(true);
    next.resolve(png()); await settle(); await expect(second).resolves.toBeInstanceOf(Blob);
    expect(toBlob).toHaveBeenCalledTimes(2);
  });
  it('fetch 中卸载优先返回 AbortError', async () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    const { ref, unmount } = host(); const task = request(ref, documentFor('mixed'), localUrl);
    await settle(); unmount();
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
});
