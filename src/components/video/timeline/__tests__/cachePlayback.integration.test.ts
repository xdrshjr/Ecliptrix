/**
 * Integration test — remote material caching → preview URL swap.
 *
 * Wires together:
 *   - RemoteMaterialPrefetchAdapter (ingest + poll)
 *   - selectPlaybackUrl (preview vs export branch)
 *   - CompositionAdapter (sequence shape with cacheUrl propagation)
 *
 * Verifies the contract that drives the whole feature:
 *   1. user adds a Pexels remote URL to materials
 *   2. adapter ingests → poll resolves with `local_url`
 *   3. that URL flows onto MaterialItem.cacheUrl → onto VideoSequenceItem.cacheUrl
 *   4. selectPlaybackUrl(preview) returns the same-origin URL
 *   5. selectPlaybackUrl(export) still returns serverUrl||url
 */

import { describe, it, expect, vi } from 'vitest';
import { RemoteMaterialPrefetchAdapter } from '../infrastructure/RemoteMaterialPrefetchAdapter';
import { CompositionAdapter } from '../infrastructure/CompositionAdapter';
import { selectPlaybackUrl } from '../../lib/selectPlaybackUrl';
import type { TrackData } from '../domain/types';

const KEY = { source: 'pexels', source_id: '12345', url: 'https://x/v.mp4' };

describe('integration: ingest → cache → preview URL swap', () => {
  it('end-to-end happy path', async () => {
    // 1. Stub fetch for ingest (returns pending) + lookup (returns ready).
    const ready = {
      source: 'pexels',
      source_id: '12345',
      material_id: 'mid-1',
      status: 'ready',
      local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/material/ingest')) {
        return new Response(
          JSON.stringify({
            success: true,
            items: [
              { source: KEY.source, source_id: KEY.source_id, material_id: 'mid-1', status: 'pending' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith('/api/material/lookup')) {
        return new Response(JSON.stringify(ready), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error('unexpected ' + url);
    });

    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
      initialDelayMs: 1,
    });

    const result = await adapter.pollUntilReady(KEY);
    expect(result.local_url).toContain('cached_materials');

    // 2. Material now has cacheUrl populated (would be the case after the
    //    prefetch hook fires its onProgress patch into setMaterials).
    const material = {
      id: 'mat-1',
      name: 'pexels.mp4',
      type: 'video' as const,
      duration: 5,
      url: KEY.url,
      serverUrl: 'https://cdn.example.com/v.mp4',
      cacheUrl: result.local_url || undefined,
    };

    // 3. CompositionAdapter forwards cacheUrl onto the VideoSequenceItem.
    const track: TrackData = {
      id: 't1',
      name: 'video-1',
      type: 'video',
      isVisible: true,
      isLocked: false,
      isMuted: false,
      volume: 100,
      height: 60,
      order: 0,
      items: [
        {
          id: 'item-1',
          name: 'clip',
          type: 'video',
          startTime: 0,
          duration: 5,
          trackId: 't1',
          materialId: 'mat-1',
          clipStart: 0,
          clipEnd: 5,
          originalDuration: 5,
          volume: 1,
        } as any,
      ],
    };
    const comp = new CompositionAdapter();
    const [seq] = comp.extractVideoSequences([track], [material as any]);

    // 4. preview URL is the same-origin cached path.
    const preview = selectPlaybackUrl(seq, { purpose: 'preview' });
    expect(preview).toBe(`${window.location.origin}${result.local_url}`);

    // 5. export URL is still the durable serverUrl — never the cacheUrl.
    const exportUrl = selectPlaybackUrl(seq, { purpose: 'export' });
    expect(exportUrl).toBe('https://cdn.example.com/v.mp4');

    // 6. The export request payload (composition request) carries
    //    serverUrl as `url` and never references cacheUrl.
    const req = comp.buildCompositionRequest([seq], [], {});
    expect(req.video_sequences[0].url).toBe('https://cdn.example.com/v.mp4');
    expect(JSON.stringify(req)).not.toContain(result.local_url);
  });

  it('failed cache leaves preview URL on origin (no regression)', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/material/ingest')) {
        return new Response(
          JSON.stringify({
            success: true,
            items: [
              {
                source: KEY.source,
                source_id: KEY.source_id,
                material_id: 'mid-1',
                status: 'failed',
                error_message: 'ffmpeg blew up',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error('unexpected ' + url);
    });
    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: () => Promise.resolve(),
    });

    const r = await adapter.pollUntilReady(KEY);
    expect(r.status).toBe('failed');

    // Material has no cacheUrl → preview must fall back to serverUrl.
    const material = {
      id: 'mat-1',
      name: 'pexels.mp4',
      type: 'video' as const,
      duration: 5,
      url: KEY.url,
      serverUrl: 'https://cdn.example.com/v.mp4',
    };
    const preview = selectPlaybackUrl(material, { purpose: 'preview' });
    expect(preview).toBe('https://cdn.example.com/v.mp4');
  });
});
