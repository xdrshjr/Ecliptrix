/**
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §3.2.8 / §7.1.
 *
 * Validates the §3.2.8 fallback path against the playbackFlags localStorage
 * key. Sibling PlaybackEngine.test.ts covers the engine-internal kill state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPlaybackV2Enabled,
  resolvePlaybackFlag,
  tripPlaybackV2KillSwitch,
  clearPlaybackV2KillSwitch,
  PLAYBACK_FLAG_KEYS,
} from '@/lib/playbackFlags';

describe('playbackFlags — kill-switch (§3.2.8)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('flag is enabled when localStorage explicitly opts in', () => {
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.storage, 'true');
    expect(isPlaybackV2Enabled()).toBe(true);
  });

  it('kill-switch overrides every other source', () => {
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.storage, 'true');
    tripPlaybackV2KillSwitch('test_reason');
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).toBe('kill-switch');
  });

  it('clearPlaybackV2KillSwitch restores normal resolution', () => {
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.storage, 'true');
    tripPlaybackV2KillSwitch('test_reason');
    expect(isPlaybackV2Enabled()).toBe(false);
    clearPlaybackV2KillSwitch();
    expect(isPlaybackV2Enabled()).toBe(true);
  });

  it('kill-switch payload includes reason + timestamp', () => {
    tripPlaybackV2KillSwitch('drift_trip');
    const raw = window.localStorage.getItem(PLAYBACK_FLAG_KEYS.killSwitch);
    expect(raw).toMatch(/^drift_trip:\d+/);
  });
});
