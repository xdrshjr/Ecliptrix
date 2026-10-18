import { expect, it, vi, afterEach } from 'vitest';
import { GET, POST, PUT } from '../[...path]/route';
import { NextRequest } from 'next/server';

afterEach(() => vi.unstubAllGlobals());
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
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
