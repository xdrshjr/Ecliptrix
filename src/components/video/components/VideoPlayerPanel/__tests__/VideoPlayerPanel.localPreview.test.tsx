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
 * 源 ≡ 比对键, extended to the blob tier); the readiness gate disables the play
 * button + guards `handlePlayPauseClick` (degraded excluded, C3); and audio is
 * played from the local blob (C1).
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
});

describe('VideoPlayerPanel — readiness gate (§3.3.6, C2/C3)', () => {
  it('derives allTimelineMediaReady from localProxyStatus, treating degraded as non-blocking', () => {
    expect(src).toMatch(/allTimelineMediaReady/);
    // C2 — gated on the MATERIAL type (image-on-video-track must not block).
    expect(src).toMatch(/m\.type\s*!==\s*'video'\s*&&\s*m\.type\s*!==\s*'audio'/);
    // C3 — degraded is treated as resolved (non-blocking).
    expect(src).toMatch(/status\s*===\s*'degraded'/);
  });

  it('disables the play button until media is ready', () => {
    expect(src).toMatch(/disabled=\{getTotalDuration\(\)\s*===\s*0\s*\|\|\s*!allTimelineMediaReady\}/);
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
