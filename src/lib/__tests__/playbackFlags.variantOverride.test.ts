/**
 * Tests for the Phase 4 dev variant override (§F20 / §3.2.6 / §3.2.5).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PLAYBACK_FLAG_KEYS,
  isPlaybackV2Enabled,
  readPlaybackVariantOverride,
  resolvePlaybackFlag,
  setPlaybackVariantOverride,
} from '../playbackFlags';

describe('playbackFlags — variant override (dev only)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED;
  const originalDeploy = process.env.NEXT_PUBLIC_DEPLOY_ENV;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = undefined;
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'development';
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_PLAYBACK_V2_ENABLED = originalEnv;
    process.env.NEXT_PUBLIC_DEPLOY_ENV = originalDeploy;
  });

  it('force-v2 returns enabled=true with variant-override source', () => {
    setPlaybackVariantOverride('force-v2');
    expect(isPlaybackV2Enabled()).toBe(true);
    expect(resolvePlaybackFlag().source).toBe('variant-override');
  });

  it('force-legacy returns enabled=false with variant-override source', () => {
    setPlaybackVariantOverride('force-legacy');
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).toBe('variant-override');
  });

  it('auto removes the key so resolution falls through to env/default', () => {
    setPlaybackVariantOverride('force-v2');
    setPlaybackVariantOverride('auto');
    expect(readPlaybackVariantOverride()).toBeNull();
    expect(window.localStorage.getItem(PLAYBACK_FLAG_KEYS.variantOverride)).toBeNull();
    expect(resolvePlaybackFlag().source).toBe('default');
  });

  it('override is ignored when deploy env is production', () => {
    process.env.NEXT_PUBLIC_DEPLOY_ENV = 'production';
    setPlaybackVariantOverride('force-v2');
    expect(isPlaybackV2Enabled()).toBe(false);
    expect(resolvePlaybackFlag().source).not.toBe('variant-override');
  });
});
