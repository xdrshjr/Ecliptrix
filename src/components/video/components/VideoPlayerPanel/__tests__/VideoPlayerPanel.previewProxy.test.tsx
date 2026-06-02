/**
 * @vitest-environment node
 *
 * VideoPlayerPanel — preview-proxy wiring
 * (docs/plans/video-editor-preview-proxy-playback/spec.md §3.2.3 / §3.2.4).
 *
 * Like the sibling feature-flag test, we assert at the **source level** (the
 * project's `jsx: "preserve"` tsconfig keeps the Vitest pipeline from
 * compiling the .tsx). We verify the C1 invariant ("赋值源 ≡ 比对键") is
 * structurally enforced — both the assigned src and the comparison key flow
 * through the SAME proxy-aware resolver call — plus the hot-replace effect and
 * the composition-time non-decreasing guard exist.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoPlayerPanel.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('VideoPlayerPanel — preview-proxy flag', () => {
  it('imports isPreviewProxyEnabled from @/lib/playbackFlags', () => {
    expect(src).toMatch(
      /import\s*\{[^}]*\bisPreviewProxyEnabled\b[^}]*\}\s*from\s*['"]@\/lib\/playbackFlags['"]/,
    );
  });

  it('locks previewProxyEnabled with useMemo(..., []) at mount', () => {
    expect(src).toMatch(
      /previewProxyEnabled\s*=\s*useMemo\(\s*\(\)\s*=>\s*isPreviewProxyEnabled\(\)\s*,\s*\[\s*\]\s*\)/,
    );
  });
});

describe('VideoPlayerPanel — C1 赋值源 ≡ 比对键', () => {
  it('getSequencePreviewSrc delegates to resolveSequencePlaybackUrl with preferPreviewProxy', () => {
    const fn = src.slice(
      src.indexOf('const getSequencePreviewSrc'),
      src.indexOf('const getSequencePreviewSrc') + 400,
    );
    expect(fn).toMatch(/resolveSequencePlaybackUrl\(/);
    expect(fn).toMatch(/preferPreviewProxy:\s*previewProxyEnabled/);
  });

  it('assignSequenceSrc resolves the primary with the same preferPreviewProxy option', () => {
    const fn = src.slice(
      src.indexOf('const assignSequenceSrc'),
      src.indexOf('const assignSequenceSrc') + 600,
    );
    expect(fn).toMatch(/resolveSequencePlaybackUrl\(/);
    expect(fn).toMatch(/preferPreviewProxy:\s*previewProxyEnabled/);
  });
});

describe('VideoPlayerPanel — hot-replace + progress guard', () => {
  it('has a proxy-ready hot-replace effect keyed on previewProxyStatus', () => {
    expect(src).toMatch(/ppHotSwapStatusRef/);
    expect(src).toMatch(/status\s*!==\s*'cached'\s*\|\|\s*prev\s*===\s*'cached'/);
  });

  it('guards the composition-time write-back to be non-decreasing (keyed on composition time)', () => {
    // Guard compares the freshly computed composition time against the prior
    // compositionCurrentTimeRef value — NOT video.currentTime (C8).
    expect(src).toMatch(
      /accumulatedTime\s*\+\s*TIME_EPSILON\s*<\s*previousCompositionTime/,
    );
    expect(src).toMatch(
      /previousCompositionTime\s*=\s*compositionCurrentTimeRef\.current/,
    );
  });
});
