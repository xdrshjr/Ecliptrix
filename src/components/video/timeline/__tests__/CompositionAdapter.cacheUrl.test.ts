/**
 * CompositionAdapter — cacheUrl propagation regression
 *
 * The export pipeline reads `seq.url` directly. The preview pipeline opts
 * into the same-origin cached file via selectPlaybackUrl(seq, {purpose:'preview'}).
 *
 * These tests prove (a) cacheUrl is forwarded onto VideoSequenceItem, and
 * (b) the export-safe `url` field still reflects `serverUrl || url` so the
 * composition request never embeds a same-origin cached path. R12 / Rev-7.
 */

import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../infrastructure/CompositionAdapter';
import type { CompositionMaterialData } from '../infrastructure/CompositionAdapter';
import type { TrackData } from '../domain/types';
import { selectPlaybackUrl } from '../../lib/selectPlaybackUrl';

const VIDEO_TRACK: TrackData = {
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
      materialId: 'm1',
      clipStart: 0,
      clipEnd: 5,
      originalDuration: 5,
      volume: 1,
    } as any,
  ],
};

const MAT: CompositionMaterialData = {
  id: 'm1',
  name: 'sample.mp4',
  type: 'video',
  duration: 5,
  url: 'https://videos.pexels.com/v.mp4',
  serverUrl: 'https://cdn.example.com/v.mp4',
  cacheUrl: '/api/storage/files/cached_materials/pexels/12345.mp4',
};

describe('CompositionAdapter cacheUrl propagation', () => {
  it('export `url` reads serverUrl||url and never the cacheUrl', () => {
    const adapter = new CompositionAdapter();
    const sequences = adapter.extractVideoSequences([VIDEO_TRACK], [MAT as any]);
    expect(sequences).toHaveLength(1);
    expect(sequences[0].url).toBe('https://cdn.example.com/v.mp4');
    expect(sequences[0].cacheUrl).toBe(MAT.cacheUrl);
  });

  it('preview path resolves to same-origin cached URL via selectPlaybackUrl', () => {
    const adapter = new CompositionAdapter();
    const [seq] = adapter.extractVideoSequences([VIDEO_TRACK], [MAT as any]);
    const previewUrl = selectPlaybackUrl(seq, { purpose: 'preview' });
    expect(previewUrl).toContain('cached_materials');
    expect(previewUrl.startsWith(window.location.origin)).toBe(true);
  });

  it('export path skips cacheUrl', () => {
    const adapter = new CompositionAdapter();
    const [seq] = adapter.extractVideoSequences([VIDEO_TRACK], [MAT as any]);
    const exportUrl = selectPlaybackUrl(seq, { purpose: 'export' });
    expect(exportUrl).toBe('https://cdn.example.com/v.mp4');
  });

  it('buildCompositionRequest serialises export-safe url', () => {
    const adapter = new CompositionAdapter();
    const sequences = adapter.extractVideoSequences([VIDEO_TRACK], [MAT as any]);
    const req = adapter.buildCompositionRequest(sequences, [], {});
    expect(req.video_sequences[0].url).toBe('https://cdn.example.com/v.mp4');
    // The wire format MUST NOT carry cacheUrl into the backend payload.
    expect(JSON.stringify(req.video_sequences[0])).not.toContain('cacheUrl');
  });
});
