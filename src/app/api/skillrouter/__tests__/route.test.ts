/**
 * BFF contract for the AI relay settings (spec §5.2): reads pass straight
 * through and are never cached, every write must carry Origin + JSON to be
 * forwarded, and the model-resolution passthrough is never cached either.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE, GET, PUT } from '../route';
import { POST as verify } from '../verify/route';
import { POST as testSlot } from '../test-slot/route';
import { GET as catalog } from '../catalog/route';
import { GET as usage } from '../usage/route';
import { GET as resolveModel } from '../../model-settings/resolve/[functionType]/route';

afterEach(() => vi.unstubAllGlobals());

const ORIGIN = 'http://localhost:3000';
const NO_CONTEXT = { params: Promise.resolve({}) };

function stubBackend() {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json({ success: true, data: {} }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function request(method: string, path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: method === 'GET' ? headers : { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
  });
}

const WRITES = [
  ['PUT', PUT, '/api/skillrouter'],
  ['DELETE', DELETE, '/api/skillrouter'],
  ['POST', verify, '/api/skillrouter/verify'],
  ['POST', testSlot, '/api/skillrouter/test-slot'],
] as const;

describe('relay write routes', () => {
  it.each(WRITES)('rejects %s %s without Origin before reaching the backend', async (method, handler, path) => {
    const fetcher = stubBackend();
    const response = await handler(request(method, path), NO_CONTEXT);
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(WRITES)('rejects a cross-origin %s %s', async (method, handler, path) => {
    const fetcher = stubBackend();
    const response = await handler(request(method, path, { Origin: 'https://evil.example' }), NO_CONTEXT);
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(WRITES)('forwards %s %s with Origin and a JSON content type', async (method, handler, path) => {
    const fetcher = stubBackend();
    const response = await handler(request(method, path, { Origin: ORIGIN }), NO_CONTEXT);
    expect(response.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain(path);
    expect(init.method).toBe(method);
    const headers = new Headers(init.headers);
    expect(headers.get('origin')).toBe(ORIGIN);
    expect(headers.get('content-type')).toContain('application/json');
  });

  it('forwards the body of a key submission untouched', async () => {
    const fetcher = stubBackend();
    const body = JSON.stringify({ mode: 'router', apiKey: 'ar-abcdef123456' });
    const incoming = new NextRequest(`${ORIGIN}/api/skillrouter`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body,
    });
    await PUT(incoming, NO_CONTEXT);
    expect(fetcher.mock.calls[0][1].body).toBe(body);
  });

  it('never caches a write response', async () => {
    stubBackend();
    const response = await PUT(request('PUT', '/api/skillrouter', { Origin: ORIGIN }), NO_CONTEXT);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('relay read routes', () => {
  it.each([
    ['status', GET, '/api/skillrouter'],
    ['usage', usage, '/api/skillrouter/usage'],
  ] as const)('proxies %s and marks it uncacheable', async (_name, handler, path) => {
    const fetcher = stubBackend();
    const response = await handler(request('GET', path), NO_CONTEXT);
    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toContain(path);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('forwards the refresh flag of the catalogue', async () => {
    const fetcher = stubBackend();
    await catalog(request('GET', '/api/skillrouter/catalog?refresh=1'), NO_CONTEXT);
    expect(String(fetcher.mock.calls[0][0])).toMatch(/\/api\/skillrouter\/catalog\?refresh=1$/);
  });

  it('passes a backend error through with its status and code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          { success: false, message: 'x', error_code: 'router_key_invalid' },
          { status: 409 },
        ),
      ),
    );
    const response = await GET(request('GET', '/api/skillrouter'), NO_CONTEXT);
    expect(response.status).toBe(409);
    expect((await response.json()).error_code).toBe('router_key_invalid');
  });
});

describe('model resolution passthrough', () => {
  it('is never cached, because the answer follows the source mode', async () => {
    const fetcher = stubBackend();
    const response = await resolveModel(request('GET', '/api/model-settings/resolve/chat'), {
      params: Promise.resolve({ functionType: 'chat' }),
    });
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/model-settings/resolve/chat');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
