import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cache talks to the backend through waveformClient; mock it so the cache
// logic (idempotency, status flow, interval slicing) is tested in isolation.
vi.mock('../waveformClient', () => ({
  fetchWaveform: vi.fn(),
  requestWaveformGeneration: vi.fn(),
}));

import { WaveformCache } from '../waveformCache';
import { fetchWaveform, requestWaveformGeneration } from '../waveformClient';

const fetchMock = vi.mocked(fetchWaveform);
const generateMock = vi.mocked(requestWaveformGeneration);

function readyDoc(peaks: number[], peaksPerSecond = 10) {
  return {
    status: 'ready' as const,
    durationSec: peaks.length / peaksPerSecond,
    peaksPerSecond,
    peaks,
  };
}

describe('WaveformCache.ensure', () => {
  let cache: WaveformCache;

  beforeEach(() => {
    fetchMock.mockReset();
    generateMock.mockReset();
    cache = new WaveformCache();
  });

  it('returns ready and caches peaks when the backend already has them', async () => {
    fetchMock.mockResolvedValue(readyDoc([0.1, 0.2, 0.3]));
    const status = await cache.ensure('mat-1', '/api/storage/files/audio/a.mp3');
    expect(status).toBe('ready');
    expect(generateMock).not.toHaveBeenCalled();
    // Cached: a second ensure must not refetch.
    fetchMock.mockClear();
    const again = await cache.ensure('mat-1', '/api/storage/files/audio/a.mp3');
    expect(again).toBe('ready');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('triggers generation and returns pending when the waveform is missing', async () => {
    fetchMock.mockResolvedValue({ status: 'missing', peaks: null });
    generateMock.mockResolvedValue({ status: 'pending' });
    const status = await cache.ensure('mat-2', '/api/storage/files/audio/b.mp3');
    expect(status).toBe('pending');
    expect(generateMock).toHaveBeenCalledWith(
      'mat-2',
      '/api/storage/files/audio/b.mp3',
    );
  });

  it('caches peaks immediately when generation returns ready inline', async () => {
    fetchMock.mockResolvedValue({ status: 'missing', peaks: null });
    generateMock.mockResolvedValue({ status: 'ready' });
    // Second fetch (post-generation) returns the freshly persisted peaks.
    fetchMock.mockResolvedValueOnce({ status: 'missing', peaks: null });
    fetchMock.mockResolvedValueOnce(readyDoc([0.4, 0.5]));
    const status = await cache.ensure('mat-3', '/api/storage/files/audio/c.mp3');
    expect(status).toBe('ready');
  });

  it('is idempotent under concurrent ensure calls (single fetch/generate)', async () => {
    fetchMock.mockResolvedValue({ status: 'missing', peaks: null });
    generateMock.mockResolvedValue({ status: 'pending' });
    const [a, b] = await Promise.all([
      cache.ensure('mat-4', '/api/storage/files/audio/d.mp3'),
      cache.ensure('mat-4', '/api/storage/files/audio/d.mp3'),
    ]);
    expect(a).toBe('pending');
    expect(b).toBe('pending');
    // Concurrent calls collapse onto one in-flight request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('reports failed and does not crash when the backend errors', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const status = await cache.ensure('mat-5', '/api/storage/files/audio/e.mp3');
    expect(status).toBe('failed');
  });
});

describe('WaveformCache.peaksFor', () => {
  let cache: WaveformCache;

  beforeEach(() => {
    fetchMock.mockReset();
    generateMock.mockReset();
    cache = new WaveformCache();
  });

  it('returns null before the waveform is ready', () => {
    expect(cache.peaksFor('unknown', {})).toBeNull();
  });

  it('returns the full peaks array when no clip interval is given', async () => {
    fetchMock.mockResolvedValue(readyDoc([0.1, 0.2, 0.3, 0.4], 1));
    await cache.ensure('mat-full', '/api/storage/files/audio/f.mp3');
    expect(cache.peaksFor('mat-full', {})).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('slices to the [clipStart, clipEnd] interval', async () => {
    // 10 peaks @ 1 pps → 10s. clip=[2,5] → indices [2,5)
    const peaks = Array.from({ length: 10 }, (_, i) => i / 10);
    fetchMock.mockResolvedValue(readyDoc(peaks, 1));
    await cache.ensure('mat-clip', '/api/storage/files/audio/g.mp3');
    const sliced = cache.peaksFor('mat-clip', { clipStart: 2, clipEnd: 5 });
    expect(sliced).toEqual(peaks.slice(2, 5));
  });

  it('exposes status() reflecting the current cache state', async () => {
    expect(cache.status('mat-x')).toBe('idle');
    fetchMock.mockResolvedValue(readyDoc([0.5]));
    await cache.ensure('mat-x', '/api/storage/files/audio/h.mp3');
    expect(cache.status('mat-x')).toBe('ready');
  });
});
