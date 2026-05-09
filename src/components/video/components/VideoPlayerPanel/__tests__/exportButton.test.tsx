/**
 * @vitest-environment node
 *
 * VideoPlayerPanel export-button gating — iter3 Bug #6.
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoPlayerPanel.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('VideoPlayerPanel — Bug #6 export gating', () => {
  it('introduces hasAnyExportableItem useMemo bounded on timelineState', () => {
    expect(src).toMatch(/hasAnyExportableItem\s*=\s*useMemo/);
    expect(src).toMatch(/timelineState\?\.tracks\s*\?\?\s*\[\]/);
    expect(src).toMatch(/track\.items\?\.length\s*\?\?\s*0/);
  });

  it('disables the export button when isExporting OR !hasAnyExportableItem', () => {
    expect(src).toMatch(/disabled=\{videoExport\.isExporting\s*\|\|\s*!hasAnyExportableItem\}/);
  });

  it('title carries the emptyTimeline copy only when not exporting and timeline is empty', () => {
    expect(src).toMatch(
      /!hasAnyExportableItem\s*&&\s*!videoExport\.isExporting[\s\S]+?emptyTimeline/,
    );
  });

  it('aria-label flips through 3 branches: exporting / empty / normal', () => {
    expect(src).toMatch(/videoExport\.isExporting\s*\n?\s*\?\s*`\$\{t\.videoPlayerPanel\.export\.exporting\}/);
    expect(src).toMatch(/!hasAnyExportableItem\s*\n?\s*\?\s*t\.videoPlayerPanel\.export\.emptyTimeline/);
  });

  it('Enter/Space keyboard handler additionally checks hasAnyExportableItem', () => {
    expect(src).toMatch(
      /\(e\.key\s*===\s*['"]Enter['"]\s*\|\|\s*e\.key\s*===\s*['"]\s['"]\)\s*&&\s*!videoExport\.isExporting\s*&&\s*hasAnyExportableItem/,
    );
  });

  it('does NOT hardcode tabIndex={0} (modification 6 — let disabled handle Tab order)', () => {
    // The button block immediately preceding `videoExport.isExporting ? (` JSX
    // must not contain `tabIndex={0}` anymore.
    const exportBlock = src.match(
      /\{\s*\/\*\s*导出视频按钮\s*\*\/\s*\}[\s\S]+?<\/button>/,
    );
    expect(exportBlock).not.toBeNull();
    expect(exportBlock![0]).not.toMatch(/tabIndex=\{0\}/);
  });
});
