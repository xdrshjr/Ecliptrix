/**
 * MediaProxyClient — phase-3 spec §5.5 / G6.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaProxyClient } from '../MediaProxyClient';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MediaProxyClient', () => {
  describe('buildProxyUrl', () => {
    it('builds same-origin proxy URL for http(s)', () => {
      const c = new MediaProxyClient();
      expect(c.buildProxyUrl('https://cdn/v.mp4')).toBe(
        '/api/media/proxy?u=' + encodeURIComponent('https://cdn/v.mp4'),
      );
    });
    it('passes through same-origin / blob / data URLs unchanged', () => {
      const c = new MediaProxyClient();
      expect(c.buildProxyUrl('/api/storage/files/x.mp4')).toBe('/api/storage/files/x.mp4');
      expect(c.buildProxyUrl('blob:http://x/abc')).toBe('blob:http://x/abc');
    });
    it('returns empty for empty input', () => {
      const c = new MediaProxyClient();
      expect(c.buildProxyUrl('')).toBe('');
    });
  });

  describe('requestPreviewProxy idempotency (INV4)', () => {
    it('dedupes concurrent requests for the same materialId', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          task_id: 'pp-1',
          material_id: 'mid',
          status: 'queued',
          preview_proxy_url: null,
        }),
      );
      const c = new MediaProxyClient({ fetchImpl });
      const a = c.requestPreviewProxy('mid');
      const b = c.requestPreviewProxy('mid');
      const [r1, r2] = await Promise.all([a, b]);
      expect(r1).toBe(r2);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('cached short-circuit returns cached status', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          task_id: null,
          material_id: 'mid',
          status: 'cached',
          preview_proxy_url: '/api/storage/files/preview-proxies/x.mp4',
        }),
      );
      const c = new MediaProxyClient({ fetchImpl });
      const r = await c.requestPreviewProxy('mid');
      expect(r.status).toBe('cached');
      expect(r.preview_proxy_url).toContain('preview-proxies');
    });

    it('rejects when neither material_id nor source_url provided', async () => {
      const c = new MediaProxyClient();
      await expect(c.requestPreviewProxy('' as any)).rejects.toThrow(/material_id/);
    });
  });

  describe('watchPreviewProxy', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('polls until cached and stops automatically', async () => {
      const responses = [
        { task_id: 'pp', material_id: 'mid', status: 'running', preview_proxy_url: null, profile: 'preview-480p', progress_percent: 30, last_error: null, transcoded_at: null, duration_sec: null, bytes: null },
        { task_id: 'pp', material_id: 'mid', status: 'cached', preview_proxy_url: '/api/storage/files/x.mp4', profile: 'preview-480p', progress_percent: 100, last_error: null, transcoded_at: null, duration_sec: null, bytes: null },
      ];
      let i = 0;
      const fetchImpl = vi.fn().mockImplementation(() => {
        const r = responses[Math.min(i, responses.length - 1)];
        i++;
        return Promise.resolve(jsonResponse(r));
      });
      const c = new MediaProxyClient({ fetchImpl, pollIntervalMs: 100, pollBudgetMs: 10_000 });
      const updates: any[] = [];
      const stop = c.watchPreviewProxy('mid', (s) => updates.push(s));

      // Tick #1
      await vi.advanceTimersByTimeAsync(100);
      // Tick #2
      await vi.advanceTimersByTimeAsync(100);

      expect(updates.length).toBeGreaterThanOrEqual(2);
      expect(updates[updates.length - 1].status).toBe('cached');
      stop();
    });

    it('budget timeout terminates the watch', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          task_id: 'pp',
          material_id: 'mid',
          status: 'running',
          preview_proxy_url: null,
          profile: 'preview-480p',
          progress_percent: 50,
          last_error: null,
          transcoded_at: null,
          duration_sec: null,
          bytes: null,
        }),
      );
      const c = new MediaProxyClient({ fetchImpl, pollIntervalMs: 50, pollBudgetMs: 100 });
      let lastSnap: any = null;
      const stop = c.watchPreviewProxy('mid', (s) => { lastSnap = s; });
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
      // Budget exceeded — further ticks should not fire.
      const callsBefore = fetchImpl.mock.calls.length;
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchImpl.mock.calls.length).toBe(callsBefore);
      stop();
      expect(lastSnap?.status).toBe('running');
    });

    it('explicit unsubscribe cancels polling', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(
        jsonResponse({
          task_id: 'pp',
          material_id: 'mid',
          status: 'running',
          preview_proxy_url: null,
          profile: 'preview-480p',
          progress_percent: 10,
          last_error: null,
          transcoded_at: null,
          duration_sec: null,
          bytes: null,
        }),
      );
      const c = new MediaProxyClient({ fetchImpl, pollIntervalMs: 50, pollBudgetMs: 10_000 });
      const stop = c.watchPreviewProxy('mid', () => {});
      stop();
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
