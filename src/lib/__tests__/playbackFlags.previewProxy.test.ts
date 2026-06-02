/**
 * Tests for the preview-proxy feature flag resolver
 * (docs/plans/video-editor-preview-proxy-playback/spec.md §3.2.1 / G4).
 *
 * Invariants: default ON, localStorage/env override, and full independence
 * from the playback-v2 kill-switch.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isPreviewProxyEnabled,
  isPlaybackV2Enabled,
  PLAYBACK_FLAG_KEYS,
  tripPlaybackV2KillSwitch,
  clearPlaybackV2KillSwitch,
} from '../playbackFlags';

describe('playbackFlags.isPreviewProxyEnabled', () => {
  const originalEnv = process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED;

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED = undefined;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED = originalEnv;
    window.localStorage.clear();
  });

  it('defaults to true when nothing is set', () => {
    expect(isPreviewProxyEnabled()).toBe(true);
  });

  it('localStorage "false" disables it', () => {
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.previewProxy, 'false');
    expect(isPreviewProxyEnabled()).toBe(false);
  });

  it('localStorage "true" keeps it enabled', () => {
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.previewProxy, 'true');
    expect(isPreviewProxyEnabled()).toBe(true);
  });

  it('env "false" disables it when no localStorage override', () => {
    process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED = 'false';
    expect(isPreviewProxyEnabled()).toBe(false);
  });

  it('localStorage "true" overrides env "false"', () => {
    process.env.NEXT_PUBLIC_PREVIEW_PROXY_ENABLED = 'false';
    window.localStorage.setItem(PLAYBACK_FLAG_KEYS.previewProxy, 'true');
    expect(isPreviewProxyEnabled()).toBe(true);
  });

  it('is independent of the playback-v2 kill-switch', () => {
    // Tripping the v2 kill-switch turns v2 off but must NOT disable previews.
    tripPlaybackV2KillSwitch('test');
    try {
      expect(isPlaybackV2Enabled()).toBe(false);
      expect(isPreviewProxyEnabled()).toBe(true);
    } finally {
      clearPlaybackV2KillSwitch();
    }
  });

  it('exposes its storage key constant', () => {
    expect(PLAYBACK_FLAG_KEYS.previewProxy).toBe('ecliptrix-preview-proxy');
  });
});
