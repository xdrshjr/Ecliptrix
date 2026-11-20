import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/config/backend', () => ({ backendConfig: { joinPath: (path: string) => 'http://backend' + path } }));
import { GET } from './route';
import { DELETE as cancelPreparation } from '../preview-prepare/route';

afterEach(() => vi.unstubAllGlobals());
it('Range 头及 206 原样回传，响应头到达后取消仍会关闭后端流', async () => {
  let signal!: AbortSignal;
  const cancelled = vi.fn();
  const stream = new ReadableStream({ cancel: cancelled });
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    signal = init.signal!;
    return new Response(stream, { status: 206, headers: {
      'Content-Range': 'bytes 0-3/1000', 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
    } });
  }));
  const request = new NextRequest('http://app/api/youtube/preview-stream?video_id=abcdefghijk', { headers: { Range: 'bytes=0-3' } });
  const response = await GET(request);
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 0-3/1000');
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('video_id=abcdefghijk'),
    expect.objectContaining({ headers: { Range: 'bytes=0-3' } }));
  await response.body!.cancel();
  expect(signal.aborted).toBe(true);
  expect(cancelled).toHaveBeenCalled();
});

it('客户端断连监听在收到响应头后依然有效', async () => {
  let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    signal = init.signal!;
    return new Response(new ReadableStream());
  }));
  const controller = new AbortController();
  const response = await GET(new NextRequest('http://app/api/youtube/preview-stream?video_id=abcdefghijk', { signal: controller.signal }));
  controller.abort();
  expect(signal.aborted).toBe(true);
  await response.body!.cancel();
});

it('预览准备取消保留后端 204 空响应，不转成 500', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
    status: 204,
  })));
  const request = new NextRequest(
    'http://app/api/youtube/preview-prepare?session=cancel-test',
    { method: 'DELETE' },
  );
  const response = await cancelPreparation(request, {
    params: Promise.resolve({}),
  });
  expect(response.status).toBe(204);
  expect(response.body).toBeNull();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/youtube/preview/prepare?session=cancel-test'),
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('预览准备取消仍保留后端失败状态和原因', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(
    { detail: 'PREVIEW_LIMIT' }, { status: 429 },
  )));
  const response = await cancelPreparation(new NextRequest(
    'http://app/api/youtube/preview-prepare?session=cancel-test',
    { method: 'DELETE' },
  ), { params: Promise.resolve({}) });
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ detail: 'PREVIEW_LIMIT' });
});
