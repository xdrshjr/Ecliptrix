import { afterEach, expect, it, vi } from 'vitest';
import { ResearchRunClient } from '@/lib/server/researchRunClient';

afterEach(() => vi.unstubAllGlobals());
it('registers lazily, single-flight, and closes with a server-held token', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    success: true, data: { run_id: '00000000-0000-4000-8000-000000000001', run_token: 'SECRET' },
  })));
  vi.stubGlobal('fetch', fetcher);
  const client = new ResearchRunClient({});
  expect(fetcher).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([client.headers('a'), client.headers('b')]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(a['X-Research-Token']).toBe('SECRET');
  expect(b['X-Tool-Call-Id']).toBe('b');
  fetcher.mockResolvedValue(new Response('{}'));
  await client.close();
  expect(fetcher.mock.calls[1][1].method).toBe('DELETE');
  await expect(client.headers('late')).rejects.toThrow('cancelled');
});
it('cleans up registration that finishes after cancellation', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }))
    .mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const client = new ResearchRunClient({});
  const pending = client.headers('a');
  const assertion = expect(pending).rejects.toThrow('cancelled');
  const closing = client.close();
  resolve(new Response(JSON.stringify({ success: true,
    data: { run_id: '00000000-0000-4000-8000-000000000002', run_token: 'secret' } })));
  await assertion;
  await closing;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

/**
 * AC-G03 (spec v2 §4.8) — an unconfirmed call cancellation only degrades the
 * rest of *this turn*. The assertion inverted here used to require the exact
 * C-3 behaviour: one failed cleanup closing the whole run.
 */
it('keeps the run alive when call cancellation is unconfirmed', async () => {
  const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ success: true,
    data: { run_id: '00000000-0000-4000-8000-000000000001', run_token: 'secret' } }))
    .mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch', fetcher);
  const client = new ResearchRunClient({});
  await client.headers('call');
  await client.cancelCall('call');
  expect(client.controller.signal.aborted).toBe(false);
  expect(client.lostReason).toBe('cancel_unconfirmed');
  // The 15 s lease is untouched, so the backend expiry stays the only deadline.
  expect(clearIntervalSpy).not.toHaveBeenCalled();
  // Not closed: new headers are still issued for the same run.
  await expect(client.headers('next')).resolves.toMatchObject({ 'X-Research-Token': 'secret' });
  clearIntervalSpy.mockRestore();
  await client.close();
});

it('keeps the run alive when the cancellation is rejected with 500', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ success: true,
    data: { run_id: '00000000-0000-4000-8000-000000000003', run_token: 'secret' } }))
    .mockResolvedValue(new Response('{}', { status: 500 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new ResearchRunClient({});
  await client.headers('call');
  await client.cancelCall('call');
  expect(client.controller.signal.aborted).toBe(false);
  expect(client.lostReason).toBe('cancel_unconfirmed');
  await client.close();
});

it('closes the run when the backend says the run is gone (404)', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ success: true,
    data: { run_id: '00000000-0000-4000-8000-000000000004', run_token: 'secret' } }))
    .mockResolvedValue(new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new ResearchRunClient({});
  await client.headers('call');
  await client.cancelCall('call');
  expect(client.controller.signal.aborted).toBe(true);
  expect(client.lostReason).toBeNull();
});
