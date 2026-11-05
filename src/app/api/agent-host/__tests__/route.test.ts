import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Agent host BFF 白名单代理（docs/plans/agent-general-assistant/spec.md §6
 * 「BFF 契约」/ AC-G18）。
 *
 * 刻意**不**启动后端：断言的是代理自身的判据——路径/方法白名单、Origin、
 * JSON 与 Content-Type、`timeout_ms` 的拒绝语义（拒绝而不是静默截断）、
 * 查询串过滤、超时与网络故障的 504/502 区分。
 */

const BASE = 'http://localhost:3000/api/agent-host';
const ORIGIN = 'http://localhost:3000';
const WRITE_HEADERS = {
  origin: ORIGIN,
  'content-type': 'application/json',
};

interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

async function loadRoute() {
  return import('@/app/api/agent-host/[...path]/route');
}

function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split('/') }) };
}

function request(path: string, init: RequestInitLike = {}) {
  return new NextRequest(`${BASE}/${path}`, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error_code?: string };
  return body.error_code ?? '';
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({ success: true, data: {} }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('agent-host BFF', () => {
  it('404s an unregistered method/path combination', async () => {
    const route = await loadRoute();
    // `shell/run` 只登记在 POST 上：GET 是未登记组合。
    const response = await route.GET(
      request('shell/run', { headers: { origin: ORIGIN } }),
      ctx('shell/run'),
    );
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s a path segment carrying a dot or percent escape', async () => {
    const route = await loadRoute();
    const response = await route.POST(
      request('fs/%2e%2e/read', {
        method: 'POST',
        headers: WRITE_HEADERS,
        body: '{}',
      }),
      ctx('fs/%2e%2e/read'),
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403s a write without an origin', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('shell/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"command":"echo hi"}',
    }), ctx('shell/run'));
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe('origin_forbidden');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403s a cross-site write that carries a loopback origin', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('fs/list', {
      method: 'POST',
      headers: { ...WRITE_HEADERS, 'sec-fetch-site': 'cross-site' },
      body: '{"path":"."}',
    }), ctx('fs/list'));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('415s a write whose content-type is not JSON', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('fs/read', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
      body: '{"path":"a.txt"}',
    }), ctx('fs/read'));
    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe('json_required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s an out-of-range timeout_ms instead of clamping it', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('shell/run', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({
        command: 'ping -n 60 127.0.0.1',
        timeout_ms: 800_000,
      }),
    }), ctx('shell/run'));
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('invalid_argument');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the documented maximum timeout_ms', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('shell/run', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body: JSON.stringify({ command: 'echo hi', timeout_ms: 600_000 }),
    }), ctx('shell/run'));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, {
      signal?: AbortSignal;
    }];
    // `BACKEND_URL` 随环境变化（测试环境由 setup/.env 注入），只钉路径。
    expect(String(url)).toMatch(/\/api\/agent-host\/shell\/run$/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('forwards limit=10 on GET /audit and drops unlisted params', async () => {
    const route = await loadRoute();
    await route.GET(new NextRequest(
      `${BASE}/audit?limit=10&evil=1&project_id=p1`,
      { headers: { origin: ORIGIN, 'x-tool-call-id': 'call-7' } },
    ), ctx('audit'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/agent-host/audit');
    expect(String(url)).toContain('limit=10');
    expect(String(url)).toContain('project_id=p1');
    expect(String(url)).not.toContain('evil=1');
    const headers = (init as { headers: Headers }).headers;
    expect(headers.get('x-tool-call-id')).toBe('call-7');
    expect(headers.get('origin')).toBe(ORIGIN);
    // 绝不转发凭据：本应用无 cookie、无 authorization。
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
  });

  it('504s when the upstream times out', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
    );
    const route = await loadRoute();
    const response = await route.GET(
      request('capabilities', { headers: { origin: ORIGIN } }),
      ctx('capabilities'),
    );
    expect(response.status).toBe(504);
    expect(await errorCode(response)).toBe('upstream_timeout');
  });

  it('502s on a transport failure that is not a timeout', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const route = await loadRoute();
    const response = await route.GET(
      request('capabilities', { headers: { origin: ORIGIN } }),
      ctx('capabilities'),
    );
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe('upstream_unavailable');
  });

  it('413s a JSON body over the 2 MiB + 8 KiB budget', async () => {
    const route = await loadRoute();
    const body = 'x'.repeat(2 * 1024 * 1024 + 9 * 1024);
    const response = await route.POST(request('fs/write', {
      method: 'POST',
      headers: WRITE_HEADERS,
      body,
    }), ctx('fs/write'));
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe('request_too_large');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('502s response_too_large above the 8 MiB body cap', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), { status: 200 }),
    );
    const route = await loadRoute();
    const response = await route.GET(
      request('capabilities', { headers: { origin: ORIGIN } }),
      ctx('capabilities'),
    );
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe('response_too_large');
  });

  it('marks responses no-store + nosniff, passthrough status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { enabled: true },
    }, 418));
    const route = await loadRoute();
    const response = await route.GET(
      request('capabilities', { headers: { origin: ORIGIN } }),
      ctx('capabilities'),
    );
    expect(response.status).toBe(418);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toBe('application/json');
  });
});
