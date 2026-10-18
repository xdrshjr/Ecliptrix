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

it('stops renewing the entire network run if call cancellation is unconfirmed', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ success: true,
    data: { run_id: '00000000-0000-4000-8000-000000000001', run_token: 'secret' } }))
    .mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch', fetcher);
  const client = new ResearchRunClient({});
  await client.headers('call');
  await client.cancelCall('call');
  expect(client.controller.signal.aborted).toBe(true);
  await client.close();
});
