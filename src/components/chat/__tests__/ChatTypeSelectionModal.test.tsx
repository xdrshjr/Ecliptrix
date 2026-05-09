/**
 * @vitest-environment node
 *
 * ChatTypeSelectionModal disabled-empty + relative-time + ID — iter3 Bug #4.
 *
 * Source-level regex assertions because the project's Vitest config
 * (tsconfig jsx: "preserve") cannot mount React components.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'ChatTypeSelectionModal.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('ChatTypeSelectionModal — Bug #4 source structure', () => {
  it('uses the shared formatRelativeTime utility (iter7 Bug #3 — removed inline relativeTimeEN)', () => {
    expect(src).toMatch(/import\s+\{[^}]*formatRelativeTime[^}]*\}\s+from\s+['"]@\/lib\/relativeTime['"]/);
    expect(src).toMatch(/formatRelativeTime\(workflow\.updated_at\s*\|\|\s*workflow\.created_at,\s*locale,\s*t/);
    // The previous English-only inline helper must be gone.
    expect(src).not.toMatch(/const\s+relativeTimeEN\s*=/);
  });

  it('sortedWorkflows useMemo sorts newest-first using updated_at then created_at', () => {
    expect(src).toMatch(/sortedWorkflows\s*=\s*useMemo/);
    expect(src).toMatch(/Date\.parse\(w\.updated_at\s*\|\|\s*['"]['"]\)/);
    expect(src).toMatch(/Date\.parse\(w\.created_at\s*\|\|\s*['"]['"]\)/);
  });

  it('emptyWorkflowCount useMemo counts workflows with 0 nodes', () => {
    expect(src).toMatch(/emptyWorkflowCount\s*=\s*useMemo/);
    expect(src).toMatch(/\(w\.nodes\?\.length\s*\?\?\s*0\)\s*===\s*0/);
  });

  it('handleSelectWorkflow guards against empty workflows (defensive no-op)', () => {
    expect(src).toMatch(
      /if\s*\(\(workflow\.nodes\?\.length\s*\?\?\s*0\)\s*===\s*0\)\s*\{[\s\S]+?return;/,
    );
  });

  it('workflow card is a <button> with disabled + aria-disabled + title gate on isEmpty', () => {
    expect(src).toMatch(/disabled=\{isEmpty\}/);
    expect(src).toMatch(/aria-disabled=\{isEmpty\s*\|\|\s*undefined\}/);
    expect(src).toMatch(/title=\{isEmpty\s*\?\s*t\.aiChat\.chatTypeModal\.emptyWorkflowHint\s*:\s*undefined\}/);
  });

  it('idShort guard: only renders ID row when non-empty', () => {
    expect(src).toMatch(
      /const\s+idShort\s*=\s*\(workflow\.workflow_id\s*\?\?\s*['"]['"]\)\.replace\(\/-\/g,\s*['"]['"]\)\.slice\(-6\);/,
    );
    expect(src).toMatch(/\{idShort\s*&&\s*\(/);
  });

  it('footer count uses workflowsAvailableWithEmpty when emptyWorkflowCount > 0', () => {
    expect(src).toMatch(/emptyWorkflowCount\s*>\s*0/);
    expect(src).toMatch(/workflowsAvailableWithEmpty/);
    expect(src).toMatch(/\.replace\(['"]\{empty\}['"]/);
  });
});
