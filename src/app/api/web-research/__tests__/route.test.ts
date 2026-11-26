import { expect, it, vi, afterEach } from 'vitest';
import { GET, POST, PUT } from '../[...path]/route';
import { NextRequest } from 'next/server';

afterEach(() => vi.unstubAllGlobals());
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
const UUID = '123e4567-e89b-42d3-a456-426614174000';
it('never exposes run registration to the renderer', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await POST(new NextRequest('http://localhost:3000/api/web-research/runs',
    { method: 'POST', body: '{}' }), ctx(['runs']))).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects cross-origin writes before accessing the backend', async () => {
  expect((await PUT(new NextRequest('http://localhost:3000/api/web-research/credentials',
    { method: 'PUT', headers: { origin: 'https://evil.example',
      'content-type': 'application/json' }, body: '{}' }), ctx(['credentials']))).status).toBe(403);
});
it('rejects oversized JSON regardless of Content-Length', async () => {
  expect((await POST(new NextRequest('http://localhost:3000/api/web-research/search',
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'a'.repeat(65536) }) }), ctx(['search']))).status).toBe(413);
});
it('permits same-origin capabilities reads and preserves backend status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  expect((await GET(new NextRequest('http://localhost:3000/api/web-research/capabilities'),
    ctx(['capabilities']))).status).toBe(503);
});

/**
 * AC-I22 (agent-browser-image-ingest spec §4.2): the proxy is an explicit
 * method+path whitelist, so `save-image` must be listed or the endpoint is 404'd
 * here and never reaches FastAPI (P0-1).
 */
it('lets the save-image path through the POST whitelist', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({ success: true, data: { status: 'ready' } }));
  vi.stubGlobal('fetch', fetcher);
  const response = await POST(new NextRequest(
    `http://localhost:3000/api/web-research/browser/${UUID}/save-image`,
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image_id: 'i1' }) }),
    ctx(['browser', UUID, 'save-image']));
  expect(response.status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('still rejects unlisted and malformed browser paths', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const paths = [
    ['browser', UUID, 'delete-image'],
    ['browser', 'not-a-uuid', 'save-image'],
    ['browser', UUID, 'save-image', 'extra'],
  ];
  for (const path of paths) {
    const response = await POST(new NextRequest(
      `http://localhost:3000/api/web-research/${path.join('/')}`,
      { method: 'POST', headers: { 'content-type': 'application/json' },
        body: '{}' }), ctx(path));
    expect(response.status, path.join('/')).toBe(404);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
