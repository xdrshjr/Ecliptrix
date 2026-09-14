/**
 * @vitest-environment node
 *
 * TimelineItem — round-3 clip-bar download visualization
 * (docs/plans/video-editor-track-download-progress/spec.md §3.3.3, G2).
 *
 * Like the sibling VideoPlayerPanel / preview-proxy tests, we assert at the
 * **source level**: the project's `jsx: "preserve"` tsconfig keeps Vitest
 * (esbuild) from compiling the .tsx, so `render(<TimelineItem/>)` would fail at
 * module load. We instead read TimelineItem.tsx and assert the render branches /
 * style expressions / event wiring exist (spec §7.1, P1-2).
 *
 * G2: the clip bar ITSELF becomes the progress bar — downloading dims only the
 * not-yet-downloaded portion (right of progress%); transcoding pulses;
 * error/degraded colour the bar with a clickable retry. ready/idle/undefined →
 * no overlay.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The download-overlay render was extracted from TimelineItem into the
// TimelineItemDownloadOverlay component (Phase-4 cleanup); the source-level
// assertions below now read that module, where the branches live verbatim.
const FILE = resolve(__dirname, '..', 'TimelineItemDownloadOverlay.tsx');
const src = readFileSync(FILE, 'utf-8');
const PANEL_FILE = resolve(__dirname, '..', 'TimelinePanel.tsx');
const panelSrc = readFileSync(PANEL_FILE, 'utf-8');
const PLACEMENT_FILE = resolve(__dirname, '..', 'domain', 'services', 'ItemPlacementService.ts');
const placementSrc = readFileSync(PLACEMENT_FILE, 'utf-8');

describe('TimelineItem — local-download render guards (C2/C4)', () => {
  it('renders nothing when local preview is off', () => {
    const fn = src.slice(
      src.indexOf('const TimelineItemDownloadOverlay'),
      src.indexOf('const TimelineItemDownloadOverlay') + 2600,
    );
    expect(fn).toMatch(/if\s*\(\s*!localPreviewEnabled\s*\)\s*return null/);
  });

  it('only video/audio clips with a materialId are eligible', () => {
    const fn = src.slice(
      src.indexOf('const TimelineItemDownloadOverlay'),
      src.indexOf('const TimelineItemDownloadOverlay') + 2600,
    );
    expect(fn).toMatch(/item\.type\s*!==\s*'video'\s*&&\s*item\.type\s*!==\s*'audio'/);
    expect(fn).toMatch(/if\s*\(\s*!item\.materialId\s*\)\s*return null/);
  });

  it('only transcoding/downloading/error/degraded render (ready/idle/undefined → null)', () => {
    const fn = src.slice(
      src.indexOf('const TimelineItemDownloadOverlay'),
      src.indexOf('const TimelineItemDownloadOverlay') + 2600,
    );
    expect(fn).toMatch(/status\s*!==\s*'transcoding'/);
    expect(fn).toMatch(/status\s*!==\s*'downloading'/);
    expect(fn).toMatch(/status\s*!==\s*'error'/);
    expect(fn).toMatch(/status\s*!==\s*'degraded'/);
    expect(fn).toMatch(/return null/);
  });
});

describe('TimelineItem direct-local materials', () => {
  it('omits direct-local materials from the status map so normal blocks render', () => {
    expect(panelSrc).toMatch(/canPreviewDirectLocalMaterial\(m\)/);
    expect(panelSrc).toMatch(/if\s*\(\s*canPreviewDirectLocalMaterial\(m\)\s*\)\s*return/);
  });

  it('TimelinePanel preserves local playback fields in MaterialData snapshots', () => {
    // The MaterialItem → MaterialData mapping is shared with the script
    // auto-mix through ItemPlacementService.toMaterialData; drops must use it.
    expect(panelSrc).toMatch(/addItemAction\([^;]*toMaterialData\(material\)\)/);
    const start = placementSrc.indexOf('export function toMaterialData');
    const block = placementSrc.slice(start, start + 700);
    expect(block).toMatch(/cacheUrl:\s*material\.cacheUrl/);
    expect(block).toMatch(/storageKey:\s*material\.storageKey/);
    expect(block).toMatch(/metadata:\s*material\.metadata/);
    expect(block).not.toMatch(/as any/);
  });
});

describe('TimelineItem — downloading: the bar itself is the progress bar (G2)', () => {
  it('clamps progress to 0..100', () => {
    expect(src).toMatch(/Math\.max\(0,\s*Math\.min\(100,\s*Math\.round\(/);
  });

  it('dims only the not-yet-downloaded portion (right of pct%)', () => {
    expect(src).toMatch(/left:\s*`\$\{pct\}%`/);
    expect(src).toMatch(/rgba\(0,0,0,0\.45\)/);
  });

  it('shows a download badge with the percentage, truncated on narrow clips', () => {
    expect(src).toMatch(/localDownloading/);
    expect(src).toMatch(/\{pct\}%/);
    expect(src).toMatch(/truncate/);
  });
});

describe('TimelineItem — transcoding: indeterminate pulse (G2)', () => {
  it('uses an indeterminate pulse + spinner + label', () => {
    expect(src).toMatch(/animate-pulse/);
    expect(src).toMatch(/animate-spin/);
    expect(src).toMatch(/localTranscoding/);
  });
});

describe('TimelineItem — error / degraded: clickable retry (G2, R2)', () => {
  it('error shows a retry that calls onRetryLocalDownload and blocks drag', () => {
    expect(src).toMatch(/onRetryLocalDownload\(item\.materialId\)/);
    expect(src).toMatch(/onClick=\{retry\}/);
    expect(src).toMatch(/onPointerDown=\{stopDrag\}/);
    expect(src).toMatch(/stopPropagation/);
    expect(src).toMatch(/localDownloadFailed/);
  });

  it('degraded shows a "will stream" retry', () => {
    expect(src).toMatch(/localWillStream/);
  });
});
