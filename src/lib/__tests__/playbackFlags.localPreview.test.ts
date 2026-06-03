/**
 * Tests for the local-preview feature flag resolver
 * (docs/plans/video-editor-client-preview-download/spec.md §3.3.1 / G6).
 *
 * Invariants: default ON, localStorage/env override, and full independence
 * from both the preview-proxy flag and the playback-v2 kill-switch (C7).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isLocalPreviewEnabled,
  isPreviewProxyEnabled,
  isPlaybackV2Enabled,
  PLAYBACK_FLAG_KEYS,
  tripPlaybackV2KillSwitch,
  clearPlaybackV2KillSwitch,
} from '../playbackFlags';

describe('playbackFlags.isLocalPreviewEnabled', () => {
  const originalEnv = process.env.NEXT_PUBLIC_LOCAL_PREVIEW_ENABLED;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    process.env.NEXT_PUBLIC_LOCAL_PREVIEW_ENABLED = undefined;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_LOCAL_PREVIEW_ENABLED = originalEnv;
    window.localStorage.clear();
  });

  it('defaults to true when nothing is set', () => {
    expect(isLocalPreviewEnabled()).toBe(true);
  });

  it('localStorage "false" disables it', () => {
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.localPreview, 'false');
    expect(isLocalPreviewEnabled()).toBe(false);
  });

  it('localStorage "true" keeps it enabled', () => {
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.localPreview, 'true');
    expect(isLocalPreviewEnabled()).toBe(true);
  });

  it('env "false" disables it when no localStorage override', () => {
    process.env.NEXT_PUBLIC_LOCAL_PREVIEW_ENABLED = 'false';
    expect(isLocalPreviewEnabled()).toBe(false);
  });

  it('localStorage "true" overrides env "false"', () => {
    process.env.NEXT_PUBLIC_LOCAL_PREVIEW_ENABLED = 'false';
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.localPreview, 'true');
    expect(isLocalPreviewEnabled()).toBe(true);
  });

  it('is independent of the preview-proxy flag', () => {
    // Disabling local-preview must NOT disable the round-1 streaming proxy.
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.localPreview, 'false');
    expect(isLocalPreviewEnabled()).toBe(false);
    expect(isPreviewProxyEnabled()).toBe(true);
  });

  it('is independent of the playback-v2 kill-switch', () => {
    tripPlaybackV2KillSwitch('test');
    try {
      expect(isPlaybackV2Enabled()).toBe(false);
      expect(isLocalPreviewEnabled()).toBe(true);
    } finally {
      clearPlaybackV2KillSwitch();
    }
  });

  it('exposes its storage key constant', () => {
    expect(PLAYBACK_FLAG_KEYS.localPreview).toBe('ecliptrix-local-preview');
  });
});
