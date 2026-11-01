/**
 * BFF contract for integration credentials (spec §3.5 "BFF 契约", AC2-17):
 * every write must carry Origin + JSON to be forwarded, the id segment is
 * whitelisted, and DELETE forwards Origin just like PUT / POST.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { DELETE, PUT } from '../[id]/route';
import { POST as testConnection } from '../[id]/test/route';

afterEach(() => vi.unstubAllGlobals());

const ORIGIN = 'http://localhost:3000';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function write(method: string, id: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}/api/integrations/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'DELETE' ? undefined : '{}',
  });
}

function stubBackend() {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json({ success: true, data: {} }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('integration write routes', () => {
  it.each([
    ['PUT', PUT],
    ['DELETE', DELETE],
  ] as const)('rejects a %s without Origin before reaching the backend', async (method, handler) => {
    const fetcher = stubBackend();
    const response = await handler(write(method, 'ark'), ctx('ark'));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a test request without Origin', async () => {
    const fetcher = stubBackend();
    const response = await testConnection(write('POST', 'ark/test'), ctx('ark'));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin write', async () => {
    const fetcher = stubBackend();
    const response = await PUT(write('PUT', 'ark', { Origin: 'https://evil.example' }), ctx('ark'));
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a write that is not JSON (backend would answer 415)', async () => {
    const fetcher = stubBackend();
    const request = new NextRequest(`${ORIGIN}/api/integrations/ark`, {
      method: 'DELETE',
      headers: { Origin: ORIGIN },
    });
    expect((await DELETE(request, ctx('ark'))).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['PUT', PUT, 'PUT', '/api/integrations/ark'],
    ['DELETE', DELETE, 'DELETE', '/api/integrations/ark'],
  ] as const)('forwards Origin and JSON content type on %s', async (method, handler, verb, path) => {
    const fetcher = stubBackend();
    const response = await handler(write(method, 'ark', { Origin: ORIGIN }), ctx('ark'));
    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain(path);
    expect(init.method).toBe(verb);
    const headers = new Headers(init.headers);
    expect(headers.get('origin')).toBe(ORIGIN);
    expect(headers.get('content-type')).toContain('application/json');
  });

  it('forwards Origin on the test route and targets /test', async () => {
    const fetcher = stubBackend();
    const response = await testConnection(
      write('POST', 'pexels/test', { Origin: ORIGIN }),
      ctx('pexels'),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('/api/integrations/pexels/test');
    expect(new Headers(init.headers).get('origin')).toBe(ORIGIN);
  });

  it.each(['../secrets', 'ARK', 'a'.repeat(33), 'ark/../x', 'ark1'])(
    'answers 404 for the unsafe id %s without calling the backend',
    async (id) => {
      const fetcher = stubBackend();
      const response = await PUT(write('PUT', 'x', { Origin: ORIGIN }), ctx(id));
      expect(response.status).toBe(404);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('integration list route', () => {
  it('proxies GET without requiring Origin', async () => {
    const fetcher = stubBackend();
    const response = await GET(new NextRequest(`${ORIGIN}/api/integrations`), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/integrations');
  });
});
