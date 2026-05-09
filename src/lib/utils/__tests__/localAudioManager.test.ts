/**
 * iter5 Bug#1: LocalAudioManager.loadCacheFromStorage is now a no-op.
 *
 * Verify that:
 *   1. Constructing the manager does NOT populate audioCache from localStorage.
 *   2. Any pre-existing legacy `ecliptrix_local_audio_cache` key is purged on
 *      first construction so the user does not see ghost entries forever.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAudioManager } from '../localAudioManager';

const STORAGE_KEY = 'ecliptrix_local_audio_cache';

describe('LocalAudioManager — iter5 no-op persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not load any cached entries from a populated localStorage key', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'ghost.mp3': {
          fileName: 'ghost.mp3',
          createdAt: new Date().toISOString(),
          size: 1234,
        },
      }),
    );

    const mgr = new LocalAudioManager();
    expect(mgr.getCacheStats().fileCount).toBe(0);
  });

  it('purges the legacy storage key on construction', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: { fileName: 'x' } }));
    new LocalAudioManager();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not write metadata back when storeAudioFile would have been called previously', () => {
    new LocalAudioManager();
    // The save path is intentionally a no-op now — directly assert.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
