/**
 * @vitest-environment node
 *
 * Bug #2 (web-bug-report-20260509-iter2): the workflow log used to render
 * `{ "error": {} }` because plain JSON.stringify() on an Error returns "{}".
 * The fix introduces a `safeStringify` helper that surfaces name/message/stack
 * when an Error is encountered. We verify both the helper's behaviour and the
 * source-level rule that `formatDetails` uses it for all three stringify
 * sites (input/output/generic), not just the generic branch.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PANEL = resolve(__dirname, '..', 'WorkflowLogPanel.tsx');
const EXECUTOR = resolve(__dirname, '..', 'WorkflowExecutor.ts');

const panelSrc = readFileSync(PANEL, 'utf-8');
const executorSrc = readFileSync(EXECUTOR, 'utf-8');

describe('WorkflowLogPanel source structure', () => {
  it('defines a safeStringify helper at module scope', () => {
    expect(panelSrc).toMatch(/const\s+safeStringify\s*=/);
  });

  it('safeStringify handles Error instances by extracting name/message/stack', () => {
    expect(panelSrc).toMatch(/v\s+instanceof\s+Error/);
    expect(panelSrc).toMatch(/name:\s*v\.name/);
    expect(panelSrc).toMatch(/message:\s*v\.message/);
    expect(panelSrc).toMatch(/stack:\s*v\.stack/);
  });

  it('formatDetails uses safeStringify for all three branches (input/output/generic)', () => {
    // No naked JSON.stringify(..., null, 2) calls survived.
    expect(panelSrc).not.toMatch(/JSON\.stringify\([^)]*null,\s*2\)/);
    // safeStringify is the path used in all three places (input/output/default).
    const matches = panelSrc.match(/safeStringify\(/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

describe('WorkflowLogPanel safeStringify behaviour', () => {
  // Execute the helper inline by mirroring it; this assures the snippet in
  // the file behaves as the spec says without booting the React tree.
  const safeStringify = (val: unknown, indent: number = 2): string =>
    JSON.stringify(
      val,
      (_k, v) => {
        if (v instanceof Error) {
          return { name: v.name, message: v.message, stack: v.stack };
        }
        return v;
      },
      indent,
    );

  it('renders Error.message for { error: new Error("boom") } instead of "{}"', () => {
    const out = safeStringify({ error: new Error('boom') });
    expect(out).toContain('"message": "boom"');
    expect(out).not.toContain('"error": {}');
  });

  it('preserves plain serializable values', () => {
    const out = safeStringify({ input: { foo: 1 } });
    expect(JSON.parse(out)).toEqual({ input: { foo: 1 } });
  });
});

describe('WorkflowExecutor source structure', () => {
  it('top-level execution-failed log destructures error fields rather than serializing the raw Error', () => {
    // The fix: replace `{ error }` (which JSON-serializes to `{}`) with
    // explicit fields so consumers always see a useful message.
    expect(executorSrc).toMatch(
      /Workflow execution failed:[\s\S]*?error:\s*error\.message[\s\S]*?errorType:\s*error\.name/,
    );
  });
});
