import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PUT as batch } from '../[category]/route';
import { PUT as single } from '../[category]/[key]/route';
import { POST as reset } from '../[category]/reset/route';
import { POST as resetAll } from '../reset-all/route';

afterEach(() => vi.unstubAllGlobals());
it.each([batch, single, reset, resetAll])('rejects missing Origin on every research mutation', async handler => {
  const response = await handler(new NextRequest('http://localhost:3000/api/system-settings/web_research',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  { params: Promise.resolve({ category: 'web_research', key: 'enabled' }) });
  expect(response.status).toBe(403);
});
it('forwards only the configured renderer origin', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true, data: {} }));
  vi.stubGlobal('fetch', fetcher);
  const response = await batch(new NextRequest('http://localhost:3000/api/system-settings/web_research',
    { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: '{}' }),
  { params: Promise.resolve({ category: 'web_research' }) });
  expect(response.status).toBe(200);
  expect(new Headers(fetcher.mock.calls[0][1].headers).get('origin')).toBe('http://localhost:3000');
});
