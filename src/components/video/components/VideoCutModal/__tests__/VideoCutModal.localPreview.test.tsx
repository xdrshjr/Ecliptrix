/**
 * @vitest-environment node
 *
 * VideoCutModal local preview wiring.
 *
 * The project keeps TSX source-level tests for large video components. This
 * guards the important contract: both original and clip-preview videos use the
 * shared resolver output, not `material.url` directly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoCutModal.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('VideoCutModal — local preview source', () => {
  it('imports and calls resolveSequencePlaybackUrl', () => {
    expect(src).toMatch(/import\s*\{\s*resolveSequencePlaybackUrl\s*\}/);
    expect(src).toMatch(/resolveSequencePlaybackUrl\(/);
    expect(src).toMatch(/preferLocalProxy:\s*true/);
    expect(src).toMatch(/preferPreviewProxy:\s*true/);
  });

  it('assigns both video elements from the resolved videoSource', () => {
    const srcAssignments = Array.from(src.matchAll(/src=\{videoSource\}/g));
    expect(srcAssignments).toHaveLength(2);
    expect(src).not.toMatch(/src=\{material\.url\}/);
  });

  it('preserves the resolved local reference when exporting clips', () => {
    expect(src).toMatch(/localResolvedUrl:\s*videoSource/);
    expect(src).toMatch(/resolvedSourceKind:\s*resolvedPlayback\?\.source/);
  });

  it('loops clip preview by range instead of playing through the full source', () => {
    expect(src).toMatch(/currentTime\s*>=\s*previewClip\.endTime/);
    expect(src).toMatch(/currentTime\s*=\s*previewClip\.startTime/);
  });
});
