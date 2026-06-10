/**
 * @vitest-environment node
 *
 * VideoPlayerPanel — sole-path compositor mount (spec 02 §2.7 / §2.8, S4).
 *
 * Source-level assertions (the project's vitest config cannot compile the
 * panel's JSX under `jsx: "preserve"`). S4 made the multi-track compositor the
 * SOLE preview path and removed ALL playback-v2 feature-flag machinery + the v1
 * inline player. We verify at the source level that:
 *  - the new PreviewCanvas + useCompositionPlayback are imported + mounted
 *    UNCONDITIONALLY (no flag gate, `enabled: true`);
 *  - NO playback-v2 flag / killswitch / PreviewSurface / PlaybackVariantSwitcher
 *    / v1 <video> element / MOUNT_LEGACY_V2_SURFACE remain;
 *  - the surviving decoupled preview-proxy / local-preview flags are kept.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(
  resolve(__dirname, '..', 'VideoPlayerPanel.tsx'),
  'utf-8',
);

describe('VideoPlayerPanel — S4 sole compositor path', () => {
  it('imports PreviewCanvas and the useCompositionPlayback hook', () => {
    expect(PANEL).toMatch(/import\s+PreviewCanvas\s+from\s+'\.\/PreviewCanvas'/);
    expect(PANEL).toMatch(
      /import\s*\{\s*useCompositionPlayback\s*\}\s*from\s*'\.\.\/\.\.\/hooks\/useCompositionPlayback'/,
    );
  });

  it('mounts useCompositionPlayback UNCONDITIONALLY (enabled: true)', () => {
    expect(PANEL).toMatch(/const\s+compositionPreview\s*=\s*useCompositionPlayback\(/);
    expect(PANEL).toMatch(/enabled:\s*true/);
  });

  it('injects the locked resolver flags into the hook (RC-B options consistency)', () => {
    expect(PANEL).toMatch(/preferPreviewProxy:\s*previewProxyEnabled/);
    expect(PANEL).toMatch(/preferLocalProxy:\s*localPreviewEnabled/);
  });

  it('renders PreviewCanvas bound to the hook hostRef (no flag gate)', () => {
    expect(PANEL).toMatch(/<PreviewCanvas[\s\S]*?ref=\{compositionPreview\.hostRef\}/);
  });

  it('removes ALL playback-v2 flag machinery + the v1 player', () => {
    expect(PANEL).not.toMatch(/isPlaybackV2Enabled/);
    expect(PANEL).not.toMatch(/playbackV2Enabled/);
    expect(PANEL).not.toMatch(/tripPlaybackV2KillSwitch/);
    expect(PANEL).not.toMatch(/MOUNT_LEGACY_V2_SURFACE/);
    expect(PANEL).not.toMatch(/PreviewSurface/);
    expect(PANEL).not.toMatch(/PlaybackVariantSwitcher/);
    expect(PANEL).not.toMatch(/v2OverlaysProvider/);
    // No raw <video> element drives the preview anymore (compositor-only).
    expect(PANEL).not.toMatch(/<video\b/);
  });

  it('keeps the decoupled preview-proxy + local-preview flags', () => {
    expect(PANEL).toMatch(
      /import\s*\{[^}]*\bisPreviewProxyEnabled\b[^}]*\bisLocalPreviewEnabled\b[^}]*\}\s*from\s*'@\/lib\/playbackFlags'/,
    );
    expect(PANEL).toMatch(/previewProxyEnabled\s*=\s*useMemo\(\s*\(\)\s*=>\s*isPreviewProxyEnabled\(\)/);
    expect(PANEL).toMatch(/localPreviewEnabled\s*=\s*useMemo\(\s*\(\)\s*=>\s*isLocalPreviewEnabled\(\)/);
  });

  it('delegates transport + the imperative handle to the extracted useCompositionTransport hook (D10 split)', () => {
    expect(PANEL).toMatch(
      /import\s*\{\s*useCompositionTransport[\s\S]*?\}\s*from\s*'\.\/useCompositionTransport'/,
    );
    expect(PANEL).toMatch(/const\s+transport\s*=\s*useCompositionTransport\(/);
    // The hook receives the forwarded ref so it can wire the imperative handle.
    expect(PANEL).toMatch(/ref,/);
  });

  it('stays under the 800-line file cap after the D10 split', () => {
    expect(PANEL.split('\n').length).toBeLessThanOrEqual(800);
  });
});

describe('useCompositionTransport — imperative handle owner', () => {
  const HOOK = readFileSync(
    resolve(__dirname, '..', 'useCompositionTransport.ts'),
    'utf-8',
  );
  it('owns the imperative VideoPlayerPanelRef the parent drives', () => {
    expect(HOOK).toMatch(/useImperativeHandle\(\s*ref/);
    expect(HOOK).toMatch(/seekAndPlayFromTimeline/);
    expect(HOOK).toMatch(/pauseFromTimeline/);
    expect(HOOK).toMatch(/handleCompositionSeek/);
    expect(HOOK).toMatch(/handlePlayPauseFromTimeline/);
  });
});
