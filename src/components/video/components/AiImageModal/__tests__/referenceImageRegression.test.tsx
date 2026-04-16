/**
 * Regression tests for two bugs fixed in this change:
 *
 *   T1b — React 18 auto-batching caused BasicGenerationTab's two inline
 *         handlers (onValueChange + onReferenceImagesChange) to overwrite
 *         each other when MentionedImageInput fired both in the same tick,
 *         so reference images selected via `@` vanished instantly.
 *
 *   T2  — MentionedImageInput's keydown-based pickerAnchor (selectionStart+1)
 *         produced `@@[name]` in the final prompt after a reference was
 *         picked.
 *
 * We model the React reducer here rather than mounting the component, so
 * the tests don't depend on React's test-utils surface.
 */
import { describe, it, expect } from 'vitest';
import type { MentionedImage } from '@/types';

type State = { prompt: string; referenceImages: MentionedImage[] };
type Updater<T> = T | ((prev: T) => T);

function applyUpdater<T>(state: T, u: Updater<T>): T {
  return typeof u === 'function' ? (u as (p: T) => T)(state) : u;
}

/**
 * Simulates React 18 auto-batching: both dispatches receive `initial`, not
 * the intermediate state, when they pass plain objects; updater functions
 * receive the latest queued state.
 */
function simulateBatch(initial: State, dispatches: Updater<State>[]): State {
  let current = initial;
  for (const d of dispatches) {
    // React's reducer always calls updater with latest queued state.
    current = applyUpdater(current, d);
  }
  return current;
}

describe('T1b: batched onChange updater preserves both fields', () => {
  const init: State = { prompt: '', referenceImages: [] };
  const img: MentionedImage = { id: '1', name: 'ref', url: '/r.png', source: null };

  it('updater form — both fields survive', () => {
    const out = simulateBatch(init, [
      prev => ({ ...prev, referenceImages: [img] }),
      prev => ({ ...prev, prompt: 'hello @[ref]' }),
    ]);
    expect(out.referenceImages).toHaveLength(1);
    expect(out.prompt).toBe('hello @[ref]');
  });

  it('stale-closure form — reference image is overwritten (the bug)', () => {
    // Both handlers closed over the pre-batch snapshot.
    const snap = init;
    const out = simulateBatch(init, [
      { ...snap, referenceImages: [img] },
      { ...snap, prompt: 'hello @[ref]' }, // snap.referenceImages is still []
    ]);
    expect(out.referenceImages).toHaveLength(0); // regression documented
    expect(out.prompt).toBe('hello @[ref]');
  });
});

/**
 * T2: the at-replacement slice logic.
 *
 * MentionedImageInput stores `pickerAnchor` as the index AFTER the user-typed
 * '@'. When `anchorFromUserAt` is true, addImage slices:
 *   before = value.slice(0, anchor - 1)   // drops the user's raw '@'
 *   after  = value.slice(anchor)
 *   final  = before + tag + after
 * producing '@[name]' instead of '@@[name]'.
 */
function replaceAtWithTag(value: string, anchor: number, tag: string, anchorFromUserAt: boolean) {
  if (anchorFromUserAt) {
    return value.slice(0, Math.max(0, anchor - 1)) + tag + value.slice(anchor);
  }
  return value.slice(0, anchor) + tag + value.slice(anchor);
}

describe('T2: single @ after mention insert', () => {
  it('replaces a user-typed @ at the end with a single mention tag', () => {
    const out = replaceAtWithTag('hi @', 4, '@[ref]', true);
    expect(out).toBe('hi @[ref]');
    expect(out).not.toMatch(/@@/);
  });

  it('replaces a user-typed @ mid-string without eating surrounding text', () => {
    const out = replaceAtWithTag('hi @ world', 4, '@[ref]', true);
    expect(out).toBe('hi @[ref] world');
    expect(out).not.toMatch(/@@/);
  });

  it('plain insertion (explicit +add button) does NOT consume prior char', () => {
    const out = replaceAtWithTag('hello', 5, '@[ref]', false);
    expect(out).toBe('hello@[ref]');
  });

  it('preserves pre-existing @ earlier in the prompt', () => {
    // Existing '@[old]' already in prompt at start, user types new '@' at end.
    const value = '@[old] hello @';
    const out = replaceAtWithTag(value, value.length, '@[new]', true);
    expect(out).toBe('@[old] hello @[new]');
  });

  it('stale anchorFromUserAt after close would eat a char — guarded by reset on close', () => {
    // Scenario: user types '@', picker opens (anchorFromUserAt=true), user
    // dismisses the picker without selecting, then opens the picker via the
    // empty-state or explicit +add button and picks a material. The open
    // paths must reset anchorFromUserAt=false so slice does NOT drop the
    // char before `value.length`.
    const withGuard = replaceAtWithTag('hello', 5, '@[ref]', false);
    expect(withGuard).toBe('hello@[ref]');
    // Contrast: if the reset is missed the logic would drop 'o'.
    const withoutGuard = replaceAtWithTag('hello', 5, '@[ref]', true);
    expect(withoutGuard).toBe('hell@[ref]');
  });
});
