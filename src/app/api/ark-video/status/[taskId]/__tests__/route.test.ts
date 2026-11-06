// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config/backend', () => ({ backendConfig: { baseUrl: 'http://127.0.0.1:18321', url: 'http://127.0.0.1:18321' } }));
const get = vi.hoisted(() => vi.fn().mockResolvedValue(new Response('{"error_code":"provider_authentication"}', { status: 502 })));
vi.mock('@/lib/api/server/backend-proxy', () => ({ backendProxy: { get } }));
import { GET } from '../route';

it('只透传显式重新收取参数，保留状态错误与查询时限', async () => {
  get.mockResolvedValueOnce(new Response('{"error_code":"provider_authentication"}', { status: 502 }));
  const response = await GET(new NextRequest('http://localhost/api/ark-video/status/native?retry_artifact=true&secret=sentinel'), { params: Promise.resolve({ taskId: 'native' }) });
  expect(get.mock.calls[0][0].nextUrl.search).toBe('?retry_artifact=true');
  expect(get.mock.calls[0][3]).toEqual({ timeoutMs: 25000 });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error_code: 'provider_authentication' });
});
