import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * agent-skills BFF 白名单代理（spec agent-steering-and-skills §5.1 / AC-B11）。
 *
 * 不启动后端：断言代理自身的判据——方法 × 路径白名单、Origin 与 JSON 的区分、
 * 体上限、不转发凭据与查询串，以及空路径经同级 route.ts 转入。
 */

async function loadRoute() {
  return import('@/app/api/agent-skills/[...path]/route');
}
async function loadRootRoute() {
  return import('@/app/api/agent-skills/route');
}

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
) {
  const suffix = path ? `/${path}` : '';
  return new NextRequest(`http://localhost:3000/api/agent-skills${suffix}`, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
  });
}

function ctx(path: string) {
  return { params: Promise.resolve({ path: path ? path.split('/') : [] }) };
}

const ORIGIN = { origin: 'http://localhost:3000' };
const JSON_HEADERS = { ...ORIGIN, 'content-type': 'application/json' };

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(
    JSON.stringify({ success: true, data: {} }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent-skills BFF whitelist', () => {
  it.each([
    ['GET', 'index'], ['GET', 'explainer-video'],
    ['POST', 'validate'], ['POST', 'my-skill/enabled'], ['POST', 'my-skill/duplicate'],
    ['PUT', 'my-skill'], ['DELETE', 'my-skill'],
  ])('forwards %s /%s', async (method, path) => {
    const route = await loadRoute();
    const hasBody = method === 'POST' || method === 'PUT';
    const handler = route[method as 'GET' | 'POST' | 'PUT' | 'DELETE'];
    const response = await handler(request(path, {
      method, headers: hasBody ? JSON_HEADERS : ORIGIN, body: hasBody ? '{}' : undefined,
    }), ctx(path));
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/agent-skills/${path}`);
  });

  it.each([
    ['GET', 'validate/x'], ['GET', 'my-skill/enabled'], ['GET', 'ab'],
    ['GET', 'Upper'], ['GET', 'a'.repeat(41)], ['GET', '1abc'],
    ['POST', 'index'], ['POST', 'my-skill'], ['POST', 'my-skill/other'],
    ['PUT', 'index/x'], ['PUT', 'my-skill/enabled'],
    ['DELETE', 'my-skill/enabled'], ['DELETE', 'index/x'],
  ])('404s %s /%s without calling the backend', async (method, path) => {
    const route = await loadRoute();
    const handler = route[method as 'GET' | 'POST' | 'PUT' | 'DELETE'];
    const response = await handler(request(path, {
      method, headers: JSON_HEADERS, body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    }), ctx(path));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s traversal, encoded and backslash path segments', async () => {
    const route = await loadRoute();
    for (const segment of ['..', '%2e%2e', 'a%2fb', 'a\\b', '.hidden']) {
      const response = await route.GET(request('x', { headers: ORIGIN }), {
        params: Promise.resolve({ path: [segment] }),
      });
      expect(response.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not export PATCH or other unregistered methods', async () => {
    const route = await loadRoute();
    expect((route as Record<string, unknown>).PATCH).toBeUndefined();
  });
});

describe('agent-skills BFF guards', () => {
  it('403s a write without an origin even with JSON', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('validate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }), ctx('validate'));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403s a bodyless DELETE without an origin', async () => {
    const route = await loadRoute();
    const response = await route.DELETE(request('my-skill', { method: 'DELETE' }),
      ctx('my-skill'));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403s a foreign origin and a cross-site request', async () => {
    const route = await loadRoute();
    const foreign = await route.GET(request('index', {
      headers: { origin: 'http://evil.example' },
    }), ctx('index'));
    const cross = await route.GET(request('index', {
      headers: { ...ORIGIN, 'sec-fetch-site': 'cross-site' },
    }), ctx('index'));
    expect(foreign.status).toBe(403);
    expect(cross.status).toBe(403);
  });

  it('415s a body write that is not JSON (not 403)', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('validate', {
      method: 'POST', headers: { ...ORIGIN, 'content-type': 'text/plain' }, body: 'x',
    }), ctx('validate'));
    expect(response.status).toBe(415);
    const missing = await route.PUT(request('my-skill', {
      method: 'PUT', headers: ORIGIN, body: '{}',
    }), ctx('my-skill'));
    expect(missing.status).toBe(415);
  });

  it('accepts a bodyless DELETE that carries no content-type', async () => {
    // 浏览器不会给无请求体的 DELETE 加 content-type（toolkit D-19 的教训）。
    const route = await loadRoute();
    const response = await route.DELETE(request('my-skill', {
      method: 'DELETE', headers: ORIGIN,
    }), ctx('my-skill'));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toBeUndefined();
  });

  it('allows a GET without an origin header (same-origin navigation fetch)', async () => {
    const route = await loadRoute();
    const response = await route.GET(request('index'), ctx('index'));
    expect(response.status).toBe(200);
  });

  it('413s a JSON body over 128 KiB', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('validate', {
      method: 'POST', headers: JSON_HEADERS, body: 'x'.repeat(129 * 1024),
    }), ctx('validate'));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('agent-skills BFF forwarding', () => {
  it('forwards x-tool-call-id and origin, never credentials or the query string', async () => {
    const route = await loadRoute();
    await route.GET(new NextRequest(
      'http://localhost:3000/api/agent-skills/index?evil=1',
      { headers: {
        ...ORIGIN, 'x-tool-call-id': 'call-9', cookie: 'a=b',
        authorization: 'Bearer x', 'accept-language': 'zh-CN',
      } },
    ), ctx('index'));
    const [url, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Headers;
    expect(String(url)).not.toContain('evil=1');
    expect(headers.get('x-tool-call-id')).toBe('call-9');
    expect(headers.get('origin')).toBe('http://localhost:3000');
    expect(headers.get('accept-language')).toBe('zh-CN');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
  });

  it('passes the JSON body and the upstream status through', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ success: false, error_code: 'skill_exists' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    ));
    const route = await loadRoute();
    const response = await route.POST(request('', {
      method: 'POST', headers: JSON_HEADERS, body: '{"markdown":"m"}',
    }), ctx(''));
    expect(response.status).toBe(409);
    expect((await response.json()).error_code).toBe('skill_exists');
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe('{"markdown":"m"}');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('maps network failure to 502 and a timeout to 504', async () => {
    const route = await loadRoute();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await route.GET(request('index', { headers: ORIGIN }), ctx('index'))).status)
      .toBe(502);
    const timeout = new Error('t');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);
    expect((await route.GET(request('index', { headers: ORIGIN }), ctx('index'))).status)
      .toBe(504);
  });
});

describe('agent-skills root route (empty path)', () => {
  it('lists skills through the same proxy', async () => {
    const root = await loadRootRoute();
    const response = await root.GET(request('', { headers: ORIGIN }));
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0]).endsWith('/api/agent-skills')).toBe(true);
  });

  it('creates through POST with the JSON and origin guards intact', async () => {
    const root = await loadRootRoute();
    const created = await root.POST(request('', {
      method: 'POST', headers: JSON_HEADERS, body: '{"markdown":"m"}',
    }));
    expect(created.status).toBe(200);
    const noOrigin = await root.POST(request('', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    expect(noOrigin.status).toBe(403);
    const notJson = await root.POST(request('', {
      method: 'POST', headers: ORIGIN, body: '{}',
    }));
    expect(notJson.status).toBe(415);
  });
});
