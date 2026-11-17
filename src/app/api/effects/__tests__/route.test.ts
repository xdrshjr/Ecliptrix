import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));
import { GET, POST } from '../[...path]/route';

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
afterEach(() => { vi.unstubAllGlobals(); });

describe('公共 effects BFF', () => {
  it('保留 ETag / 304 空响应并拒绝转发私有头部', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 304, headers: { ETag: 'catalog', 'Set-Cookie': 'secret=x' },
    }));
    vi.stubGlobal('fetch', fetch);
    const response = await GET(new NextRequest(
      'http://localhost/api/effects/templates', {
        headers: { 'If-None-Match': 'catalog', Authorization: 'private' },
      }), context(['templates']));
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('ETag')).toBe('catalog');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(fetch.mock.calls[0][1].headers.get('If-None-Match')).toBe('catalog');
    expect(fetch.mock.calls[0][1].headers.has('Authorization')).toBe(false);
  });

  it('保留配额头和统一 error_details，将 HTML 故障转成 JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({
      success: false, error_code: 'EFFECT_QUEUE_FULL',
      error_details: { retry_after: 5 },
    }, { status: 429, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(new Response('<html>failure</html>', {
        status: 502, headers: { 'Content-Type': 'text/html' },
      })));
    const request = new NextRequest('http://localhost/api/effects/capabilities');
    const limited = await GET(request, context(['capabilities']));
    expect(limited.headers.get('Retry-After')).toBe('5');
    expect((await limited.json()).error_details.retry_after).toBe(5);
    const failed = await GET(request, context(['capabilities']));
    expect((await failed.json()).error_code).toBe('BACKEND_ERROR');
  });

  it('私有 drain 和未知路径不访问后端', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await POST(new NextRequest(
      'http://localhost/api/effects/drain', { method: 'POST' }),
    context(['effects-internal', 'drain']));
    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
