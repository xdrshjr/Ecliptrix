import { describe, expect, it, vi } from 'vitest';
import type { ScriptSegment } from '@/types';
import {
  applyScriptOps,
  registerCompanionRestorer,
  runCompanion,
  type ScriptOp,
} from '../historyCompanion';

const seg = (id: string, text = id): ScriptSegment =>
  ({ id, title: id, narrationText: text, sentences: [] }) as ScriptSegment;

describe('applyScriptOps (T-HIST-1)', () => {
  it('forward then inverse of a removal restores the segment at its index', () => {
    const start = [seg('a'), seg('b'), seg('c')];
    const ops: ScriptOp[] = [{ type: 'remove-segment', segment: seg('b'), index: 1 }];
    const removed = applyScriptOps(start, ops, 'forward');
    const restored = applyScriptOps(removed, ops, 'inverse');
    expect({ removed: removed.map((s) => s.id), restored: restored.map((s) => s.id) })
      .toEqual({ removed: ['a', 'c'], restored: ['a', 'b', 'c'] });
  });

  it('inverse keeps text typed in other segments after the command', () => {
    const ops: ScriptOp[] = [{ type: 'remove-segment', segment: seg('b'), index: 1 }];
    const edited = [seg('a', 'typed later'), seg('c')];
    const restored = applyScriptOps(edited, ops, 'inverse');
    expect(restored.map((s) => [s.id, s.narrationText]))
      .toEqual([['a', 'typed later'], ['b', 'b'], ['c', 'c']]);
  });

  it('reinserting an id that already exists is skipped (idempotent)', () => {
    const ops: ScriptOp[] = [{ type: 'remove-segment', segment: seg('b'), index: 1 }];
    expect(applyScriptOps([seg('a'), seg('b')], ops, 'inverse').map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('reorder sorts existing ids and appends new ones at the end', () => {
    const ops: ScriptOp[] = [{ type: 'reorder', beforeOrder: ['a', 'b', 'c'], afterOrder: ['c', 'a', 'b'] }];
    const next = applyScriptOps([seg('a'), seg('b'), seg('new'), seg('c')], ops, 'forward');
    expect(next.map((s) => s.id)).toEqual(['c', 'a', 'b', 'new']);
  });

  it('patch writes only listed keys and deletes keys whose value is undefined', () => {
    const ops: ScriptOp[] = [{
      type: 'patch-segment', segmentId: 'a',
      before: { appliedVoiceMaterialId: undefined, duration: 5 },
      after: { appliedVoiceMaterialId: 'v', duration: 8 },
    }];
    const forward = applyScriptOps([seg('a', 'keep')], ops, 'forward');
    const inverse = applyScriptOps(forward, ops, 'inverse');
    expect({
      forward: [forward[0].appliedVoiceMaterialId, forward[0].duration, forward[0].narrationText],
      inverseHasKey: 'appliedVoiceMaterialId' in inverse[0],
      inverseDuration: inverse[0].duration,
    }).toEqual({ forward: ['v', 8, 'keep'], inverseHasKey: false, inverseDuration: 5 });
  });
});

describe('registerCompanionRestorer (T-HIST-5)', () => {
  const payload = { companion: { kind: 'script-ops', ops: [{ type: 'reorder', beforeOrder: [], afterOrder: [] }] } };

  it('a late unregister of A does not clear B (StrictMode order)', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unregisterA = registerCompanionRestorer(a);
    unregisterA();
    const unregisterB = registerCompanionRestorer(b);
    unregisterA();
    runCompanion(payload, 'inverse');
    unregisterB();
    expect({ a: a.mock.calls.length, b: b.mock.calls.length }).toEqual({ a: 0, b: 1 });
  });

  it('a stable wrapper reads the newest commit function through a ref', () => {
    const ref = { current: vi.fn() };
    const unregister = registerCompanionRestorer((ops, direction) => ref.current(ops, direction));
    const first = ref.current;
    ref.current = vi.fn(); // re-render swapped the function
    runCompanion(payload, 'forward');
    unregister();
    expect({ old: first.mock.calls.length, fresh: ref.current.mock.calls.length }).toEqual({ old: 0, fresh: 1 });
  });

  it('payloads without a companion never call the restorer', () => {
    const fn = vi.fn();
    const unregister = registerCompanionRestorer(fn);
    runCompanion({ reason: 'ai-mix' }, 'inverse');
    unregister();
    expect(fn).not.toHaveBeenCalled();
  });
});
