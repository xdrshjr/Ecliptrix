/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('项目缩略图 BFF', () => {
  it('通过实际代理保留 JPEG 字节、查询和允许的响应头', async () => {
    const bytes = new Uint8Array([255, 216, 0, 1, 255, 217]);
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes, { headers: {
      'content-type': 'image/jpeg', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'content-length': '6',
      'set-cookie': 'private=x', 'x-internal': 'hidden',
    } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await GET(new NextRequest('http://localhost/api/video-projects/p/thumbnail?v=stamp&retry=1'), {
      params: Promise.resolve({ projectId: 'p' }),
    });
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
    expect(fetcher.mock.calls[0][0]).toMatch(/\/api\/video-projects\/p\/thumbnail\?v=stamp&retry=1$/);
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
    expect(result.headers.get('content-type')).toBe('image/jpeg');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(result.headers.get('x-internal')).toBeNull();
  });

  it.each([404, 409, 422, 503, 504])('保留上游 %i 和错误内容', async status => {
    const body = JSON.stringify({ success: false, error_code: 'PROJECT_THUMBNAIL_EMPTY' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })));
    const result = await GET(new NextRequest('http://localhost/api/video-projects/p/thumbnail'), {
      params: Promise.resolve({ projectId: 'p' }),
    });
    expect(result.status).toBe(status);
    expect(await result.text()).toBe(body);
  });

  it('客户端取消会终止上游请求', async () => {
    const controller = new AbortController();
    let upstream: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      upstream = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => upstream!.addEventListener('abort', () =>
        reject(new DOMException('取消', 'AbortError'))));
    }));
    const request = GET(new NextRequest('http://localhost/api/video-projects/p/thumbnail', {
      signal: controller.signal,
    }), { params: Promise.resolve({ projectId: 'p' }) });
    await vi.waitFor(() => expect(upstream).toBeDefined());
    controller.abort();
    expect((await request).status).toBe(499);
    expect(upstream?.aborted).toBe(true);
  });
});
