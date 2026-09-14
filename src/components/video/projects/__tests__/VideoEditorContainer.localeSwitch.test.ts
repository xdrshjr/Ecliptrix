/**
 * @vitest-environment node
 *
 * RV-01: the load effect must run once per project. Re-running it on a
 * language switch unmounted the editor (loading state), re-imported the
 * timeline from the server copy — dropping undo history and edits still
 * inside the autosave debounce — and repeated the hydration notice.
 *
 * Source-level like the other container wiring checks: tsconfig keeps JSX as
 * `preserve`, so the container cannot be rendered under Vitest.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'VideoEditorContainer.tsx'), 'utf-8');

function loadEffectDeps(): string {
  const start = src.indexOf('// Fetch the project on mount / projectId change.');
  const end = src.indexOf('const handleUpdateContent', start);
  const effect = src.slice(start, end);
  const deps = effect.match(/\}, \[([^\]]*)\]\);\s*$/);
  return deps ? deps[1] : '';
}

describe('VideoEditorContainer — locale switch', () => {
  it('switching the language does not reload the open project', () => {
    const deps = loadEffectDeps();

    expect(deps).toContain('projectId');
    expect(deps).not.toMatch(/\bt\./);
    expect(src).toMatch(/translationsRef\.current\.videoProjects\.loadError/);
  });
});
