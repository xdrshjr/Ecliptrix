/**
 * Tests for the local-preview feature flag resolver
 * (docs/plans/video-editor-client-preview-download/spec.md §3.3.1 / G6).
 *
 * Invariants: default ON, localStorage/env override, and full independence
 * from the preview-proxy flag (C7). The playback-v2 kill-switch this flag was
 * once asserted independent from was removed in S4 (the compositor is the sole
 * preview path), so that case is gone with it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isLocalPreviewEnabled,
  isPreviewProxyEnabled,
  PLAYBACK_FLAG_KEYS,
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

  it('exposes its storage key constant', () => {
    expect(PLAYBACK_FLAG_KEYS.localPreview).toBe('ecliptrix-local-preview');
  });
});
