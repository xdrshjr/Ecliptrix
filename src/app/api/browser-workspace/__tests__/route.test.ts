/**
 * BFF whitelist (spec §5.3): only `GET state` and `POST resources/save`, same
 * origin guard as the research proxy, no token ever forwarded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import * as route from '../[...path]/route';

const ORIGIN = 'http://127.0.0.1:3000';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response('{"success":true}', { status: 200 }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function call(
  handler: (r: NextRequest, c: { params: Promise<{ path: string[] }> }) => Promise<Response>,
  path: string, init: RequestInit & { origin?: string | null } = {},
) {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  const request = new Request(`${ORIGIN}/api/browser-workspace/${path}`, { ...init, headers });
  return handler(request as unknown as NextRequest, { params: Promise.resolve({ path: path.split('/') }) });
}
const postJson = (path: string, body: unknown, extra: RequestInit & { origin?: string | null } = {}) =>
  call(route.POST, path, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, ...extra,
  });

describe('browser-workspace BFF', () => {
  it('exports_only_get_and_post', () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'POST']);
  });

  it('proxies_the_diagnostics_read', async () => {
    const response = await call(route.GET, 'state');
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/browser-workspace\/state$/);
  });

  it('proxies_resource_save_with_origin_but_never_a_token_or_cookie', async () => {
    const response = await postJson('resources/save', { tab_id: 't', url: 'https://x.test/a.jpg', kind: 'image' }, {
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret', cookie: 'a=b' },
    });
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const sent = new Headers(init.headers);
    expect(sent.get('origin')).toBe(ORIGIN);
    expect(sent.get('authorization')).toBeNull();
    expect(sent.get('cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['GET', 'resources/save'], ['POST', 'state'], ['POST', 'commands'], ['POST', 'resources/save/extra'],
    ['GET', '../state'], ['POST', 'resources%2Fsave'], ['POST', 'v1/approvals'],
  ])('rejects_%s_%s_as_not_found', async (method, path) => {
    const handler = method === 'GET' ? route.GET : route.POST;
    const response = method === 'GET'
      ? await call(handler, path)
      : await postJson(path, {});
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses_a_write_from_a_foreign_origin_or_without_one', async () => {
    expect((await postJson('resources/save', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await postJson('resources/save', {}, { origin: null })).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires_json_and_caps_the_body', async () => {
    const text = await call(route.POST, 'resources/save', {
      method: 'POST', body: 'x=1', headers: { 'content-type': 'text/plain' },
    });
    expect(text.status).toBe(403); // researchOriginAllowed demands JSON for writes
    const big = await postJson('resources/save', { pad: 'x'.repeat(70000) });
    expect(big.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers_502_when_the_backend_is_down', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const response = await call(route.GET, 'state');
    expect(response.status).toBe(502);
  });
});
