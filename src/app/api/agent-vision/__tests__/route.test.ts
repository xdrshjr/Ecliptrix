import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `/api/agent-vision/*` BFF 白名单（agent-visual-review spec §5.5 / AC-22）。
 *
 * 与 `agent-toolkit` 的测试同一条纪律：刻意**不**启动后端，只断言代理自身
 * 的判据——方法 × 路径白名单、Origin、JSON、按端点分档的 body 上限、查询串
 * 过滤、凭据不转发。
 */

async function loadRoute() {
  return import('@/app/api/agent-vision/[...path]/route');
}

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {},
) {
  return new NextRequest(`http://localhost:3000/api/agent-vision/${path}`, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
  });
}

function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split('/') }) };
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

describe('agent-vision BFF', () => {
  it('404s a method/path combination that is not registered', async () => {
    const route = await loadRoute();
    // describe 只允许 POST。
    const response = await route.GET(request('describe', { headers: ORIGIN }),
      ctx('describe'));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s a traversal attempt inside an observation id', async () => {
    const route = await loadRoute();
    const response = await route.GET(request('observations/..%2Fcache', {
      headers: ORIGIN,
    }), ctx('observations/..%2Fcache'));
    expect(response.status).toBe(404);
  });

  it('403s a write without an origin', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }), ctx('describe'));
    expect(response.status).toBe(403);
  });

  it('415s a write that is not JSON', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('frames', {
      method: 'POST', headers: { ...ORIGIN, 'content-type': 'text/plain' },
      body: 'x',
    }), ctx('frames'));
    expect(response.status).toBe(415);
  });

  it('413s a describe body over 64 KiB but accepts 8 KiB on export-inspect', async () => {
    const route = await loadRoute();
    const big = 'x'.repeat(64 * 1024 + 1024);
    const rejected = await route.POST(request('describe', {
      method: 'POST', headers: JSON_HEADERS, body: big,
    }), ctx('describe'));
    expect(rejected.status).toBe(413);

    fetchMock.mockClear();
    const accepted = await route.POST(request('export-inspect', {
      method: 'POST', headers: JSON_HEADERS, body: 'x'.repeat(8 * 1024),
    }), ctx('export-inspect'));
    expect(accepted.status).toBe(200);
  });

  it('forwards x-tool-call-id and filters the query string', async () => {
    const route = await loadRoute();
    await route.GET(new NextRequest(
      'http://localhost:3000/api/agent-vision/capabilities'
      + '?project_id=p1&offset=0&evil=1',
      { headers: { ...ORIGIN, 'x-tool-call-id': 'call-9' } },
    ), ctx('capabilities'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('project_id=p1');
    expect(String(url)).toContain('offset=0');
    expect(String(url)).not.toContain('evil=1');
    const headers = init.headers as Headers;
    expect(headers.get('x-tool-call-id')).toBe('call-9');
    // 绝不转发凭据。
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
  });

  it('proxies a POST body through to the backend', async () => {
    const route = await loadRoute();
    const body = JSON.stringify({ project_id: 'p1', images: [] });
    const response = await route.POST(request('describe', {
      method: 'POST', headers: JSON_HEADERS, body,
    }), ctx('describe'));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agent-vision/describe');
    expect(init.body).toBe(body);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('cross-origin-resource-policy'))
      .toBe('same-origin');
  });

  it('504s a slow vision call instead of hanging the agent', async () => {
    fetchMock.mockImplementation(() => Promise.reject(
      new DOMException('timed out', 'TimeoutError')));
    const route = await loadRoute();
    const response = await route.POST(request('describe', {
      method: 'POST', headers: JSON_HEADERS, body: '{}',
    }), ctx('describe'));
    expect(response.status).toBe(504);
    const envelope = await response.json() as { error_code?: string };
    expect(envelope.error_code).toBe('upstream_timeout');
  });

  it('502s a network failure', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('down')));
    const route = await loadRoute();
    const response = await route.GET(request('capabilities', {
      headers: ORIGIN,
    }), ctx('capabilities'));
    expect(response.status).toBe(502);
  });
});
