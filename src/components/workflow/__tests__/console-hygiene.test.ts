/**
 * @vitest-environment node
 *
 * iter4 Bug #7: the workflow modules must use the dlog/dwarn helpers (gated
 * by NODE_ENV / __ECLIPTRIX_DEBUG__) instead of bare console.log/info/warn.
 * console.error stays so prod can still report unexpected failures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'WorkflowInterface.tsx',
  'WorkflowSidebar.tsx',
  'WorkflowCanvas.tsx',
  'WorkflowExecutor.ts',
];

describe('workflow console hygiene', () => {
  it.each(FILES)('%s imports dlog from @/lib/utils/debugLog', (file) => {
    const src = readFileSync(resolve(__dirname, '..', file), 'utf-8');
    expect(src).toMatch(/from ['"]@\/lib\/utils\/debugLog['"]/);
  });

  it.each(FILES)('%s contains no console.log / console.info calls', (file) => {
    const src = readFileSync(resolve(__dirname, '..', file), 'utf-8');
    expect(src).not.toMatch(/\bconsole\.log\(/);
    expect(src).not.toMatch(/\bconsole\.info\(/);
  });

  it.each(FILES)('%s never uses dlog.X subscript form (would crash at runtime)', (file) => {
    const src = readFileSync(resolve(__dirname, '..', file), 'utf-8');
    expect(src).not.toMatch(/\bdlog\.(log|info|error|warn)\b/);
  });
});

describe('workflow error signals preserved', () => {
  it('WorkflowInterface keeps console.error for save/delete/load failures', () => {
    const src = readFileSync(resolve(__dirname, '..', 'WorkflowInterface.tsx'), 'utf-8');
    expect(src).toMatch(/console\.error\([^)]*Error saving workflow/);
    expect(src).toMatch(/console\.error\([^)]*Error deleting workflow/);
  });

  it('WorkflowExecutor keeps console.error for unexpected diagnostic points', () => {
    const src = readFileSync(resolve(__dirname, '..', 'WorkflowExecutor.ts'), 'utf-8');
    expect(src).toMatch(/console\.error\([^)]*Execution error/);
    expect(src).toMatch(/console\.error\([^)]*Pexels Video Search/);
  });
});
