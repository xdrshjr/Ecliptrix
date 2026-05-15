/**
 * @vitest-environment node
 *
 * VideoPlayerPanel v2 smoke — Phase 2 spec
 * (docs/plans/video-editor-playback-v2-phase2/spec.md §7.2).
 *
 * Source-level regex assertions: the project's vitest config can't compile
 * JSX so we follow the same pattern as featureFlagBranch.test.tsx.
 *
 * What we verify:
 *  - Panel constructs the v2 wiring (timeline facade + resolver + overlays).
 *  - Panel renders <PreviewSurface variant="v2" .../> when flag is on.
 *  - The play button intercept dispatches to the engine when flag is on.
 *  - The kill-switch handler is wired into PreviewSurface's onKillSwitch prop.
 *  - useVideoPlayback's simulator is gated by isPlaybackV2Enabled (R5).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(
  resolve(__dirname, '..', 'VideoPlayerPanel.tsx'),
  'utf-8',
);
const HOOK = readFileSync(
  resolve(
    __dirname,
    '..',
    '..',
    '..',
    'hooks',
    'useVideoPlayback.ts',
  ),
  'utf-8',
);

describe('VideoPlayerPanel — v2 wiring (Phase 2)', () => {
  it('imports PreviewSurface and the v2 facade types', () => {
    expect(PANEL).toMatch(/import\s+PreviewSurface\s+from\s+'\.\/PreviewSurface'/);
    expect(PANEL).toMatch(/PlaybackTimelineFacade/);
    expect(PANEL).toMatch(/PlaybackSequenceResolver/);
    expect(PANEL).toMatch(/OverlayPayload/);
  });

  it('builds a memoized timeline facade from compositionPlayback', () => {
    expect(PANEL).toMatch(/v2Timeline\s*=\s*useMemo<PlaybackTimelineFacade>/);
    expect(PANEL).toMatch(/findSequenceAtCompositionTime:\s*\(t:\s*number\)/);
    expect(PANEL).toMatch(/getTotalDuration:\s*\(\)\s*=>\s*v2TotalDuration/);
  });

  it('builds a memoized resolver via resolveSequencePlaybackUrl', () => {
    expect(PANEL).toMatch(/v2Resolver\s*=\s*useMemo<PlaybackSequenceResolver>/);
    expect(PANEL).toMatch(/resolveSequencePlaybackUrl\(seq,\s*materials/);
    expect(PANEL).toMatch(/mapToMediaTime:\s*\(seq,\s*sequenceOffset\)/);
  });

  it('renders PreviewSurface variant="v2" when flag is on', () => {
    expect(PANEL).toMatch(
      /playbackV2Enabled\s*&&\s*playbackEngineRef\.current\s*&&\s*\(/,
    );
    expect(PANEL).toMatch(/<PreviewSurface[\s\S]*?variant="v2"/);
  });

  it('hides the legacy <video> when v2 is on (display: none)', () => {
    expect(PANEL).toMatch(
      /display:\s*playbackV2Enabled\s*\?\s*'none'\s*:\s*'block'/,
    );
  });

  it('handlePlayPauseClick intercepts to engine.dispatch when flag is on', () => {
    expect(PANEL).toMatch(/if\s*\(\s*playbackV2Enabled\s*&&\s*playbackEngineRef\.current\s*\)/);
    expect(PANEL).toMatch(/engine\.dispatch\(\s*\{\s*kind:\s*'play'/);
    expect(PANEL).toMatch(/engine\.dispatch\(\s*\{\s*kind:\s*'pause'/);
  });

  it('wires the kill-switch handler into PreviewSurface', () => {
    expect(PANEL).toMatch(/tripPlaybackV2KillSwitch/);
    expect(PANEL).toMatch(/onKillSwitch:\s*handleV2KillSwitch/);
  });
});

describe('useVideoPlayback — simulator gated by v2 flag (R5)', () => {
  it('imports isPlaybackV2Enabled', () => {
    expect(HOOK).toMatch(/import\s*\{\s*isPlaybackV2Enabled\s*\}\s*from\s*'@\/lib\/playbackFlags'/);
  });

  it('memo-locks the flag and early-returns the simulator effect', () => {
    expect(HOOK).toMatch(/playbackV2Enabled\s*=\s*useMemo\(\s*\(\)\s*=>\s*isPlaybackV2Enabled\(\)/);
    expect(HOOK).toMatch(/if\s*\(playbackV2Enabled\)\s*return;/);
  });
});
