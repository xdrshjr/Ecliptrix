/**
 * Tests for kill-switch INV13 (§F21 / §INV13 / R-P1-4).
 *
 * The kill-switch persists a single key (`ecliptrix-playback-v2-killswitch`);
 * once present, `isPlaybackV2Enabled` returns false regardless of every
 * other source.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PLAYBACK_FLAG_KEYS,
  clearPlaybackV2KillSwitch,
  isPlaybackV2Enabled,
  readKillSwitchReason,
  resolvePlaybackFlag,
  tripPlaybackV2KillSwitch,
} from '../playbackFlags';

describe('playbackFlags kill-switch (INV13)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED;
  const originalDeploy = process.env.NEXT_PUBLIC_DEPLOY_ENV;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = 'true';
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = originalEnv;
    process.env.NEXT_PUBLIC_DEPLOY_ENV = originalDeploy;
  });

  it('tripped killswitch forces flag off even when env enables v2', () => {
    expect(isPlaybackV2Enabled()).toBe(true);
    tripPlaybackV2KillSwitch('test-trip');
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).toBe('kill-switch');
  });

  it('persists exactly one localStorage key — no second reason key (R-P1-4)', () => {
    tripPlaybackV2KillSwitch('test-trip');
    // jsdom does not expose own-keys via Object.keys; iterate via .key().
    const matches: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.includes('killswitch')) matches.push(k);
    }
    expect(matches).toEqual([PLAYBACK_FLAG_KEYS.killSwitch]);
  });

  it('readKillSwitchReason decodes the reason / timestamp pair', () => {
    tripPlaybackV2KillSwitch('overflow');
    const decoded = readKillSwitchReason();
    expect(decoded?.reason).toBe('overflow');
    expect(decoded?.trippedAt).toBeGreaterThan(0);
  });

  it('clearPlaybackV2KillSwitch flips the flag back on', () => {
    tripPlaybackV2KillSwitch('test-trip');
    clearPlaybackV2KillSwitch();
    expect(isPlaybackV2Enabled()).toBe(true);
    expect(readKillSwitchReason()).toBeNull();
  });
});
