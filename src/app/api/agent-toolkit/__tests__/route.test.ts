import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * BFF 白名单代理（spec §4.4 / AC-33 / AC-35）。
 *
 * 这里刻意**不**启动后端：断言的是代理自身的判据——方法和路径白名单、
 * Origin、JSON 与 multipart 的差异、multipart 的字节上限、查询串过滤。
 */

const UPLOAD_ID = '11111111-2222-3333-4444-555555555555';

async function loadRoute() {
  return import('@/app/api/agent-toolkit/[...path]/route');
}

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>;
    body?: BodyInit } = {},
) {
  return new NextRequest(`http://localhost:3000/api/agent-toolkit/${path}`, {
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

describe('agent-toolkit BFF', () => {
  it('404s an unregistered method/path combination', async () => {
    const route = await loadRoute();
    const response = await route.GET(request('workspace/write', {
      headers: ORIGIN,
    }), ctx('workspace/write'));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s encoded path segments', async () => {
    const route = await loadRoute();
    const response = await route.GET(request('workspace/%2e%2e', {
      headers: ORIGIN,
    }), ctx('workspace/%2e%2e'));
    expect(response.status).toBe(404);
  });

  it('403s a write without an origin', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('workspace/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }), ctx('workspace/write'));
    expect(response.status).toBe(403);
  });

  it('415s a JSON write that is not JSON', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('workspace/write', {
      method: 'POST',
      headers: { ...ORIGIN, 'content-type': 'text/plain' },
      body: 'x',
    }), ctx('workspace/write'));
    expect(response.status).toBe(415);
  });

  it('413s a JSON body over the 2 MiB + 8 KiB budget', async () => {
    const route = await loadRoute();
    const body = 'x'.repeat(2 * 1024 * 1024 + 9 * 1024);
    const response = await route.POST(request('workspace/write', {
      method: 'POST', headers: JSON_HEADERS, body,
    }), ctx('workspace/write'));
    expect(response.status).toBe(413);
  });

  it('forwards x-tool-call-id and filters the query string', async () => {
    const route = await loadRoute();
    await route.GET(new NextRequest(
      'http://localhost:3000/api/agent-toolkit/workspace/read'
      + '?name=a.txt&page=2&evil=1&project_id=p1',
      { headers: { ...ORIGIN, 'x-tool-call-id': 'call-9' } },
    ), ctx('workspace/read'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('name=a.txt');
    expect(String(url)).toContain('project_id=p1');
    expect(String(url)).not.toContain('evil=1');
    expect((init.headers as Headers).get('x-tool-call-id')).toBe('call-9');
    // 绝不转发凭据。
    expect((init.headers as Headers).get('cookie')).toBeNull();
    expect((init.headers as Headers).get('authorization')).toBeNull();
  });

  it('404s DELETE on an unknown document id shape', async () => {
    const route = await loadRoute();
    const response = await route.DELETE(request('documents/not-a-uuid', {
      method: 'DELETE', headers: ORIGIN,
    }), ctx('documents/not-a-uuid'));
    expect(response.status).toBe(404);
  });

  it('accepts DELETE on a real uuid', async () => {
    const route = await loadRoute();
    const response = await route.DELETE(request(`documents/${UPLOAD_ID}`, {
      method: 'DELETE', headers: JSON_HEADERS,
    }), ctx(`documents/${UPLOAD_ID}`));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a bodyless DELETE that carries no content-type', async () => {
    // 浏览器不会给无请求体的 DELETE 加 content-type；矩阵里这一格的 JSON
    // 断言是「否」。要求 JSON 会让面板的删除/忘记/清空三处全部 415。
    const route = await loadRoute();
    const response = await route.DELETE(request('memory', {
      method: 'DELETE', headers: ORIGIN,
    }), ctx('memory'));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still requires Origin on a bodyless DELETE', async () => {
    const route = await loadRoute();
    const response = await route.DELETE(request('memory', { method: 'DELETE' }),
      ctx('memory'));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still requires JSON on a POST write', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('memory', {
      method: 'POST', headers: ORIGIN, body: '{}',
    }), ctx('memory'));
    expect(response.status).toBe(415);
  });

  it('rejects a non-multipart upload with json_required', async () => {
    const route = await loadRoute();
    const response = await route.POST(request('documents/upload', {
      method: 'POST', headers: JSON_HEADERS, body: '{}',
    }), ctx('documents/upload'));
    expect(response.status).toBe(415);
  });

  it('streams a multipart upload with duplex:half', async () => {
    const route = await loadRoute();
    const body = new TextEncoder().encode('--x\r\nhello\r\n--x--\r\n');
    const response = await route.POST(request('documents/upload', {
      method: 'POST',
      headers: { ...ORIGIN, 'content-type': 'multipart/form-data; boundary=x' },
      body,
    }), ctx('documents/upload'));
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { duplex?: string }).duplex).toBe('half');
  });

  it('413s a chunked upload that exceeds the byte limit', async () => {
    const route = await loadRoute();
    // 让 mock 真的把请求体读完：真实 undici 会消费流，这样计数才会发生。
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = init.body as ReadableStream<Uint8Array>;
      const reader = body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
      return new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    });
    const chunk = new Uint8Array(1024 * 1024);
    const total = 129;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= total) { controller.close(); return; }
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const response = await route.POST(request('documents/upload', {
      method: 'POST',
      headers: { ...ORIGIN, 'content-type': 'multipart/form-data; boundary=x' },
      body: stream,
    }), ctx('documents/upload'));
    expect(response.status).toBe(413);
  });

  it('passes the download content-disposition through', async () => {
    fetchMock.mockResolvedValue(new Response('body', {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': 'attachment; filename="outline.md"',
      },
    }));
    const route = await loadRoute();
    const response = await route.GET(request('workspace/download?name=a.md', {
      headers: ORIGIN,
    }), ctx('workspace/download'));
    expect(response.headers.get('content-disposition'))
      .toContain('outline.md');
    expect(response.headers.get('cross-origin-resource-policy'))
      .toBe('same-origin');
  });
});
