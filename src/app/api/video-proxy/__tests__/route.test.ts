import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

function makeRequest(urlParam: string | null): NextRequest {
  const base = 'http://localhost/api/video-proxy';
  const full = urlParam === null ? base : `${base}?url=${encodeURIComponent(urlParam)}`;
  return new NextRequest(full);
}

describe('/api/video-proxy GET', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response('video-bytes', {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '11' },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns 400 when url param is missing', async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 when url param is not a valid URL', async () => {
    const res = await GET(makeRequest('not-a-url'));
    expect(res.status).toBe(400);
  });

  it('returns 403 for a host outside the allowlist', async () => {
    const res = await GET(makeRequest('https://evil.example.com/foo.mp4'));
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('proxies the ARK content-generation CDN host (200 pass-through)', async () => {
    const res = await GET(
      makeRequest(
        'https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/video/xyz.mp4',
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT allow arbitrary volces.com subdomains', async () => {
    const res = await GET(makeRequest('https://attacker.volces.com/evil.mp4'));
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Storage is local-only now, so the old OSS bucket is off the allowlist
  // entirely — not just "other buckets are rejected", but every bucket.
  it('does NOT allow the retired OSS host', async () => {
    const res = await GET(
      makeRequest('https://ecliptrix.oss-cn-beijing.aliyuncs.com/foo/bar.mp4'),
    );
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does NOT allow arbitrary aliyuncs.com subdomains (other buckets)', async () => {
    const res = await GET(
      makeRequest('https://other-bucket.oss-cn-beijing.aliyuncs.com/foo.mp4'),
    );
    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
