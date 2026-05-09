/**
 * @vitest-environment node
 *
 * VideoProjectListView delete-confirmation interpolation — iter10 Bug #4.
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components.
 *
 * Rules from fix-plan-reviewed.md Bug #4:
 *   - handleDeleteProject must derive a safe name from project.name (or
 *     untitled fallback) and truncate to 60 chars with an ellipsis suffix.
 *   - Interpolation uses split('{name}').join(...) to replace ALL occurrences
 *     of the placeholder — a `replace` with a literal string would only
 *     replace the first match.
 *   - The confirmation dialog uses both deleteConfirmTitle and deleteConfirm
 *     templates with the {name} placeholder.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoProjectListView.tsx');
const I18N = resolve(__dirname, '../../../../lib/i18n.ts');
const src = readFileSync(FILE, 'utf-8');
const i18nSrc = readFileSync(I18N, 'utf-8');

describe('VideoProjectListView — Bug #4 delete-confirm name interpolation', () => {
  it('truncates the safeName at 60 chars with an ellipsis', () => {
    expect(src).toMatch(/TRUNCATE_AT\s*=\s*60/);
    expect(src).toMatch(/slice\(0,\s*TRUNCATE_AT\)\s*\+\s*'…'/);
  });

  it('falls back to t.videoProjects.untitled when project.name is empty/whitespace', () => {
    expect(src).toMatch(/project\.name\?\.trim\(\)\s*\|\|\s*t\.videoProjects\.untitled/);
  });

  it('uses split/join (NOT replace) to interpolate {name}', () => {
    expect(src).toMatch(/split\('\{name\}'\)\.join\(safeName\)/);
  });

  it('passes both deleteConfirmTitle and deleteConfirm through interpolation', () => {
    expect(src).toMatch(/title:\s*interpolate\(t\.videoProjects\.deleteConfirmTitle\)/);
    expect(src).toMatch(/message:\s*interpolate\(t\.videoProjects\.deleteConfirm\)/);
  });

  it('i18n.ts EN/zh-CN both define the {name} placeholder in deleteConfirm + deleteConfirmTitle', () => {
    // Interface declares the new key.
    expect(i18nSrc).toMatch(/deleteConfirmTitle:\s*string;/);
    // EN templates contain {name}.
    expect(i18nSrc).toMatch(/deleteConfirmTitle:\s*'Delete\s+"\{name\}"\?'/);
    expect(i18nSrc).toMatch(/deleteConfirm:\s*'You are about to delete project "\{name\}"/);
    // zh-CN templates contain {name}.
    expect(i18nSrc).toMatch(/deleteConfirmTitle:\s*'删除\s*"\{name\}"？'/);
    expect(i18nSrc).toMatch(/deleteConfirm:\s*'即将删除项目 "\{name\}"/);
  });
});
