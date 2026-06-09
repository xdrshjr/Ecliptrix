/**
 * @vitest-environment node
 *
 * VideoPlayerPanel — round-2 client-preview wiring
 * (docs/plans/video-editor-client-preview-download/spec.md §3.3.5 / §3.3.5b / §3.3.6).
 *
 * Like the sibling preview-proxy test, we assert at the **source level** (the
 * project's `jsx: "preserve"` tsconfig keeps Vitest from compiling the .tsx).
 * We verify: the flag is locked at mount; `preferLocalProxy` flows through the
 * SAME resolver call for both the assigned src and the comparison key (R6 — 赋值
 * 源 ≡ 比对键, extended to the blob tier); the readiness gate guards play entry
 * (`handlePlayPauseClick` + the spacebar-reachable `seekAndPlayFromTimeline`,
 * degraded excluded, C3) — round-3 keeps the play button clickable while gating
 * so the click reaches that toast guard (G3, see the round-3 block below); and
 * audio is played from the local blob (C1).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoPlayerPanel.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('VideoPlayerPanel — local-preview flag', () => {
  it('imports isLocalPreviewEnabled from @/lib/playbackFlags', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bisLocalPreviewEnabled\b[^}]*\}\s*from\s*['"]@\/lib\/playbackFlags['"]/,
    );
  });

  it('locks localPreviewEnabled with useMemo(..., []) at mount', () => {
    expect(src).toMatch(
      /localPreviewEnabled\s*=\s*useMemo\(\s*\(\)\s*=>\s*isLocalPreviewEnabled\(\)\s*,\s*\[\s*\]\s*\)/,
    );
  });
});

describe('VideoPlayerPanel — R6 赋值源 ≡ 比对键 (blob tier)', () => {
  it('getSequencePreviewSrc passes preferLocalProxy: localPreviewEnabled', () => {
    const fn = src.slice(
      src.indexOf('const getSequencePreviewSrc'),
      src.indexOf('const getSequencePreviewSrc') + 400,
    );
    expect(fn).toMatch(/preferLocalProxy:\s*localPreviewEnabled/);
  });

  it('assignSequenceSrc resolves the primary with the same preferLocalProxy option', () => {
    const fn = src.slice(
      src.indexOf('const assignSequenceSrc'),
      src.indexOf('const assignSequenceSrc') + 700,
    );
    expect(fn).toMatch(/resolveSequencePlaybackUrl\(/);
    expect(fn).toMatch(/preferLocalProxy:\s*localPreviewEnabled/);
  });

  it('assignSequenceSrc goes through resolveSequencePlaybackUrl for same-origin storage material', () => {
    const fn = src.slice(
      src.indexOf('const assignSequenceSrc'),
      src.indexOf('const assignSequenceSrc') + 900,
    );
    expect(fn).toMatch(/resolveSequencePlaybackUrl\(/);
    expect(fn).toMatch(/resolved\?\.url/);
    expect(fn).not.toMatch(/previewProxyLocalUrl\s*\|\|\s*sequence\.url/);
  });
});

describe('VideoPlayerPanel — readiness gate (§3.3.6, C2/C3)', () => {
  it('derives allTimelineMediaReady from localProxyStatus, treating degraded as non-blocking', () => {
    expect(src).toMatch(/allTimelineMediaReady/);
    // C2 — gated on the MATERIAL type (image-on-video-track must not block).
    expect(src).toMatch(/m\.type\s*!==\s*'video'\s*&&\s*m\.type\s*!==\s*'audio'/);
    expect(src).toMatch(/canPreviewDirectLocalMaterial\(m\)/);
    // C3 — degraded is treated as resolved (non-blocking).
    expect(src).toMatch(/status\s*===\s*'degraded'/);
  });

  it('guards handlePlayPauseClick against starting playback while gating', () => {
    const fn = src.slice(
      src.indexOf('const handlePlayPauseClick'),
      src.indexOf('const handlePlayPauseClick') + 900,
    );
    expect(fn).toMatch(/allTimelineMediaReadyRef\.current/);
    expect(fn).toMatch(/wantsToPlay/);
  });
});

// ---------------------------------------------------------------------------
// Round-3 (docs/plans/video-editor-track-download-progress/spec.md)
// G1: remove the persistent "素材下载中（已就绪 N/M）" notice from the player
//     controls; download progress now lives on each timeline clip bar (G2).
// G3: keep the play button clickable while gating (only disabled on empty
//     timeline) so the click reaches handlePlayPauseClick's toast guard.
// G3b (P1-1): the spacebar-reachable seekAndPlayFromTimeline must enforce the
//     same readiness gate, otherwise removing the button `disabled` leaves a
//     one-keystroke bypass.
// ---------------------------------------------------------------------------

describe('VideoPlayerPanel — round-3 play-gate corrections (G1/G3/G3b)', () => {
  it('G3: play button is disabled only when there is nothing to play', () => {
    expect(src).toMatch(/disabled=\{getTotalDuration\(\)\s*===\s*0\}/);
    // It must NOT be gated by readiness anymore — that would swallow the click.
    expect(src).not.toMatch(
      /disabled=\{getTotalDuration\(\)\s*===\s*0\s*\|\|\s*!allTimelineMediaReady\}/,
    );
  });

  it('G1: the persistent controls-row readiness notice is removed', () => {
    // The notice was the only role="status" span and the only consumer of
    // materialsStreamingNotice; both must be gone after G1.
    expect(src).not.toMatch(/role="status"/);
    expect(src).not.toMatch(/materialsStreamingNotice/);
  });

  it('G3b: seekAndPlayFromTimeline enforces the readiness gate (spacebar bypass)', () => {
    const start = src.indexOf('const seekAndPlayFromTimeline');
    expect(start).toBeGreaterThan(-1);
    const fn = src.slice(start, start + 1400);
    expect(fn).toMatch(/!allTimelineMediaReadyRef\.current/);
    expect(fn).toMatch(/showWarning\(/);
    expect(fn).toMatch(/materialsDownloading/);
    expect(fn).toMatch(/\breturn;/);
  });
});

// ---------------------------------------------------------------------------
// Round-2 timeline material preview fix
// (docs/plans/timeline-material-preview-fix/spec.md).
// RC-2: the composition-bootstrap "did the source change?" comparison key must
//       be computed by the SAME live-material resolver wrapper that produces the
//       value written to <video>.src (getSequencePreviewSrc), NOT by
//       selectPlaybackUrl(sequenceSnapshot) — otherwise an empty/stale snapshot
//       makes srcChanged=false and the source is never assigned.
// RC-3: the two previously flag-less resolveSequencePlaybackUrl calls
//       (resolvedFirstSrc + the cached-video fallback chain) must pass the same
//       locked { preferPreviewProxy, preferLocalProxy } flags as the writes.
// ---------------------------------------------------------------------------

describe('VideoPlayerPanel — RC-2 bootstrap comparison key uses the live-material resolver', () => {
  it('computes the bootstrap newSrc via getSequencePreviewSrc, not selectPlaybackUrl(snapshot)', () => {
    expect(src).toMatch(/const\s+newSrc\s*=\s*getSequencePreviewSrc\(firstSequence\)/);
    // The legacy stale-snapshot comparison key must be gone.
    expect(src).not.toMatch(
      /const\s+newSrc\s*=\s*selectPlaybackUrl\(firstSequence,\s*\{\s*purpose:\s*'preview'\s*\}\)/,
    );
  });
});

describe('VideoPlayerPanel — RC-3 unified resolver flags', () => {
  it('resolvedFirstSrc resolves with the locked preferPreviewProxy/preferLocalProxy flags', () => {
    const start = src.indexOf('const resolvedFirstSrc');
    expect(start).toBeGreaterThan(-1);
    const fn = src.slice(start, start + 500);
    expect(fn).toMatch(/resolveSequencePlaybackUrl\(/);
    expect(fn).toMatch(/preferPreviewProxy:\s*previewProxyEnabled/);
    expect(fn).toMatch(/preferLocalProxy:\s*localPreviewEnabled/);
  });

  it('the cached-video fallback chain resolves with the same locked flags', () => {
    // The fast path that builds a fallback chain from the cached <video> element.
    const anchor = src.indexOf('首个视频缓存命中，快速加载');
    expect(anchor).toBeGreaterThan(-1);
    const fn = src.slice(anchor, anchor + 900);
    expect(fn).toMatch(/resolveSequencePlaybackUrl\(firstSequence,\s*materials\s*\|\|\s*\[\]/);
    expect(fn).toMatch(/preferPreviewProxy:\s*previewProxyEnabled/);
    expect(fn).toMatch(/preferLocalProxy:\s*localPreviewEnabled/);
  });
});

describe('VideoPlayerPanel — audio from local blob (C1)', () => {
  it('getOrCreateAudioElement resolves the materialId blob when ready', () => {
    const fn = src.slice(
      src.indexOf('const getOrCreateAudioElement'),
      src.indexOf('const getOrCreateAudioElement') + 1200,
    );
    expect(fn).toMatch(/audioSequence\.materialId/);
    expect(fn).toMatch(/localProxyStatus\s*===\s*'ready'/);
    expect(fn).toMatch(/audioElement\.src\s*=\s*audioLocalBlob\s*\?\?\s*audioSequence\.url/);
  });
});
