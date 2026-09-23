/**
 * @vitest-environment node
 *
 * Export moved out of VideoPlayerPanel into the editor top bar
 * (segment-centric-editor-workbench §3.2 「状态上移」, RV-14).
 *
 * Exactly one `useVideoExport` instance may exist on the page — two would both
 * resume and poll the same export session. The panel must therefore own no
 * export hook, button or progress modal any more. The gating that used to live
 * here (iter3 Bug #6: disabled for an empty timeline) is pinned behaviourally
 * in `workbench/__tests__/useEditorExportWiring.test.ts`.
 *
 * Source-level assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot import the panel directly.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = readFileSync(resolve(__dirname, '..', 'VideoPlayerPanel.tsx'), 'utf-8');

describe('VideoPlayerPanel — export lives in the top bar (RV-14)', () => {
  it('owns no useVideoExport instance', () => {
    expect(PANEL).not.toMatch(/useVideoExport/);
  });

  it('renders no export progress modal', () => {
    expect(PANEL).not.toMatch(/VideoExportProgressModal/);
  });

  it('renders no export button', () => {
    expect(PANEL).not.toMatch(/handleVideoExport/);
    expect(PANEL).not.toMatch(/t\.videoPlayerPanel\.export\./);
  });
});
