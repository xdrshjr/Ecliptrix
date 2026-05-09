/**
 * @vitest-environment node
 *
 * iter4 Bug #2: the Run button must be disabled when the active workflow has
 * no Start node, and WorkflowExecutor.execute() must early-return rather than
 * throw when called without a Start node (deep defense for hotkey paths).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INTERFACE = resolve(__dirname, '..', 'WorkflowInterface.tsx');
const EXECUTOR = resolve(__dirname, '..', 'WorkflowExecutor.ts');

const interfaceSrc = readFileSync(INTERFACE, 'utf-8');
const executorSrc = readFileSync(EXECUTOR, 'utf-8');

describe('WorkflowInterface — run-button gate', () => {
  it('memoizes hasStartNode against the active workflow node list', () => {
    expect(interfaceSrc).toMatch(/hasStartNode\s*=\s*useMemo/);
    expect(interfaceSrc).toMatch(/n\.type\s*===\s*'start'/);
  });

  it('derives isRunDisabled from missing-workflow / running / missing-start', () => {
    expect(interfaceSrc).toMatch(/isRunDisabled\s*=\s*!activeWorkflow\s*\|\|\s*executionState\.isRunning\s*\|\|\s*!hasStartNode/);
  });

  it('exposes runDisabledTitle wired to the new i18n keys', () => {
    expect(interfaceSrc).toMatch(/runHintNoWorkflow/);
    expect(interfaceSrc).toMatch(/runHintMissingStart/);
  });

  it('the Run button uses isRunDisabled and a tooltip title', () => {
    expect(interfaceSrc).toMatch(/disabled=\{isRunDisabled\}/);
    expect(interfaceSrc).toMatch(/title=\{runDisabledTitle\s*\|\|\s*undefined\}/);
  });
});

describe('WorkflowExecutor — soft early return when no Start node', () => {
  it('checks for the Start node before mutating execution state', () => {
    // The guard must precede `this.abortController = new AbortController()`.
    const guardIdx = executorSrc.indexOf("Cannot run: no Start node");
    const abortIdx = executorSrc.indexOf("this.abortController = new AbortController()");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(abortIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(abortIdx);
  });

  it('emits a warning-level log instead of throwing through catch', () => {
    expect(executorSrc).toMatch(/this\.addLog\(['"]warning['"],\s*undefined,\s*['"]Cannot run: no Start node/);
  });

  it('still preserves the original console.error in the catch path', () => {
    expect(executorSrc).toMatch(/console\.error\(['"]\[WorkflowExecutor\] Execution error/);
  });
});
