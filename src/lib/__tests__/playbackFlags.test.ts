/**
 * Tests for the playback v2 feature flag resolver.
 *
 * Spec 01 §八 + spec 08 §4.1. Covers base (spec 01) precedence:
 * localStorage > env > default-false. Remote / URL-query layers from spec 08
 * have their own dedicated test (playbackFlags.remoteOverride.test.ts) added
 * in TODO 08.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheRemotePlaybackFlag,
  clearRemotePlaybackFlagCache,
  isPlaybackV2Enabled,
  PLAYBACK_FLAG_KEYS,
  resolvePlaybackFlag,
} from '../playbackFlags';

describe('playbackFlags.isPlaybackV2Enabled', () => {
  const originalEnv = process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED;
  const originalDeploy = process.env.NEXT_PUBLIC_DEPLOY_ENV;
  const originalSearch = window.location.search;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = undefined;
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production';
    // reset query string to a known-clean value
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, search: '' },
    });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = originalEnv;
    process.env.NEXT_PUBLIC_DEPLOY_ENV = originalDeploy;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, search: originalSearch },
    });
    vi.unstubAllGlobals();
  });

  it('returns false when nothing is set', () => {
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).toBe('default');
  });

  it('returns true when env is "true"', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = 'true';
    expect(isPlaybackV2Enabled()).toBe(true);
    expect(resolvePlaybackFlag().source).toBe('env');
  });

  it('returns false when env is "false"', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = 'false';
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).toBe('env');
  });

  it('localStorage "true" overrides env "false"', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = 'false';
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.storage, 'true');
    expect(isPlaybackV2Enabled()).toBe(true);
    expect(resolvePlaybackFlag().source).toBe('local-storage');
  });

  it('localStorage "false" overrides env "true"', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = 'true';
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.storage, 'false');
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).toBe('local-storage');
  });

  it('cached remote flag wins over env when no localStorage', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = 'false';
    cacheRemotePlaybackFlag(true);
    expect(isPlaybackV2Enabled()).toBe(true);
    expect(resolvePlaybackFlag().source).toBe('session-remote');
  });

  it('expired remote cache is ignored', () => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = 'true';
    cacheRemotePlaybackFlag(false, -1);
    expect(isPlaybackV2Enabled()).toBe(true);
    expect(resolvePlaybackFlag().source).toBe('env');
    clearRemotePlaybackFlagCache();
  });

  it('URL query overrides localStorage in dev', () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'development';
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.storage, 'false');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, search: '?playback_v2=on' },
    });
    expect(isPlaybackV2Enabled()).toBe(true);
    expect(resolvePlaybackFlag().source).toBe('url-query');
  });

  it('URL query is ignored in production', () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production';
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.storage, 'false');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, search: '?playback_v2=on' },
    });
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).toBe('local-storage');
  });
});
