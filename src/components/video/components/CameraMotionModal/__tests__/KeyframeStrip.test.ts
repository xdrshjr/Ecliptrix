/**
 * @vitest-environment node
 *
 * KeyframeStrip + StageOverlay — panel contract (T15 / C32).
 *
 * Source-level assertions, following the same pattern as
 * `CameraMotionModal.test.ts`: this repo's tsconfig uses `jsx: "preserve"`, so
 * vitest cannot mount a `.tsx` at all (N12). The geometry and the enable rules
 * are covered for real in `stageInteraction.test.ts`; what is pinned here is the
 * part that only exists in the markup — roles, disabled states, and the three
 * physical constraints from review R41, none of which any behavioural test can
 * catch because none of them makes anything throw:
 *
 *   ① pointer maths must read `getBoundingClientRect()`, not the 480×270
 *     constants (or drag sensitivity drifts with the window width);
 *   ② `wheel` must be a native NON-PASSIVE listener (or every zoom notch also
 *     scrolls the panel body, which is `overflow-y-auto`);
 *   ③ the stage must not gain a per-frame callback (or the deliberately
 *     zero-render playhead re-renders the panel at 60Hz).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(__dirname, '..');
const stripSrc = readFileSync(resolve(dir, 'KeyframeStrip.tsx'), 'utf-8');
const overlaySrc = readFileSync(resolve(dir, 'StageOverlay.tsx'), 'utf-8');
const stageSrc = readFileSync(resolve(dir, 'MotionPreviewStage.tsx'), 'utf-8');
const modalSrc = readFileSync(resolve(dir, 'CameraMotionModal.tsx'), 'utf-8');

describe('T15 — KeyframeStrip semantics', () => {
  it('is a listbox of options', () => {
    expect(stripSrc).toMatch(/role="listbox"/);
    expect(stripSrc).toMatch(/role="option"/);
    expect(stripSrc).toMatch(/aria-selected=\{index === selected\}/);
    expect(stripSrc).toMatch(/aria-orientation="horizontal"/);
  });

  it('marks the pinned endpoints as disabled instead of ignoring the gesture', () => {
    expect(stripSrc).toMatch(/const pinned = index === 0 \|\| index === count - 1/);
    expect(stripSrc).toMatch(/aria-disabled=\{pinned \|\| undefined\}/);
    expect(stripSrc).toMatch(/keyframeItemLocked/);
  });

  it('every keyframe announces its index, count and instant', () => {
    expect(stripSrc).toMatch(/aria-label=\{fill\(template, \{ index: index \+ 1, count, percent \}\)\}/);
  });

  it('disables [+] with a reason rather than silently doing nothing', () => {
    expect(stripSrc).toMatch(/disabled=\{disabled \|\| insertBlocked != null\}/);
    expect(stripSrc).toMatch(/keyframeAddBlockedOutside/);
    expect(stripSrc).toMatch(/keyframeAddBlockedTooClose/);
    expect(stripSrc).toMatch(/keyframeAddBlockedLimit/);
    expect(stripSrc).toMatch(/title=\{insertTitle\}/);
  });

  it('disables the delete button on the endpoints, with a reason', () => {
    expect(stripSrc).toMatch(/disabled=\{disabled \|\| !canRemoveStop\(motion, selected\)\}/);
    expect(stripSrc).toMatch(/keyframeRemoveBlocked/);
  });

  it('renders exactly one easing select per SEGMENT, and only for a curve', () => {
    expect(stripSrc).toMatch(/\{count > 2 && \(/);
    expect(stripSrc).toMatch(/stops\.slice\(0, -1\)\.map/);
    expect(stripSrc).toMatch(/onSegmentEasing\(index, event\.target\.value as CameraEasing\)/);
  });

  it('supports the keyboard: arrows re-time, Delete removes', () => {
    expect(stripSrc).toMatch(/event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'/);
    expect(stripSrc).toMatch(/event\.key === 'Delete' \|\| event\.key === 'Backspace'/);
    expect(stripSrc).toMatch(/event\.shiftKey \? 0\.1 : 0\.01/);
  });

  it('drags with pointer capture, and measures the track', () => {
    expect(stripSrc).toMatch(/setPointerCapture\(event\.pointerId\)/);
    expect(stripSrc).toMatch(/trackRef\.current[\s\S]{0,200}getBoundingClientRect\(\)/);
  });
});

describe('C32 ① — the overlay measures, it does not assume', () => {
  it('draws in the viewBox and measures with getBoundingClientRect', () => {
    expect(overlaySrc).toMatch(/viewBox=\{`0 0 \$\{STAGE_VIEW_W\} \$\{STAGE_VIEW_H\}`\}/);
    expect(overlaySrc).toMatch(/const rect = host\.getBoundingClientRect\(\)/);
    expect(overlaySrc).toMatch(/panDelta\(dx, dy, cropRef\.current, rect\.width, rect\.height\)/);
  });

  it('never feeds the logical constants into a pointer conversion', () => {
    // Drawing with them is correct; measuring with them is the bug (P1-4).
    expect(overlaySrc).not.toMatch(/panDelta\([^)]*STAGE_VIEW_[WH]/);
    expect(overlaySrc).not.toMatch(/rollDelta\([^)]*STAGE_VIEW_W/);
    expect(overlaySrc).not.toMatch(/orbitDelta\([^)]*STAGE_VIEW_W/);
    expect(overlaySrc).not.toMatch(/tiltDelta\([^)]*STAGE_VIEW_H/);
  });
});

describe('C32 ② — the wheel listener is native and non-passive', () => {
  it('registers on the element with passive: false and cleans up', () => {
    expect(overlaySrc).toMatch(/addEventListener\('wheel', handler, \{ passive: false \}\)/);
    expect(overlaySrc).toMatch(/removeEventListener\('wheel', handler\)/);
    expect(overlaySrc).toMatch(/event\.preventDefault\(\)/);
  });

  it('does NOT use React\'s onWheel, which is registered passive', () => {
    expect(overlaySrc).not.toMatch(/onWheel=/);
  });
});

describe('C32 ③ — no per-frame callback was added to the stage', () => {
  it('the overlay is children, not a render-prop fed per frame', () => {
    expect(stageSrc).toMatch(/children\?: React\.ReactNode/);
    // Word-bounded on BOTH sides — `requestAnimationFrame` ends in "onFrame".
    expect(stageSrc).not.toMatch(/\b(onCameraDraw|onResolvedDraw|onFrame)\b/);
  });

  it('the stage still writes its playhead straight to the DOM', () => {
    expect(stageSrc).toMatch(/writeScrubPosition\(u\)/);
    expect(stageSrc).toMatch(/slider\.value = String\(u\)/);
  });

  it('the overlay derives its drawing with useMemo on static inputs (D45)', () => {
    expect(overlaySrc).toMatch(/const drawing = useMemo\(/);
    expect(overlaySrc).toMatch(/\}, \[motion, selectedIndex\]\);/);
  });

  it('the stage renders the motion-window band (D44)', () => {
    expect(stageSrc).toMatch(/windowBand\?: \{ from: number; to: number \} \| null/);
    expect(stageSrc).toMatch(/left: `\$\{windowBand!\.from \* 100\}%`/);
  });
});

describe('the panel wires the curve through the shared gate (C23)', () => {
  it('every edit goes through keyframes.ts, never a hand-built keyframes array', () => {
    expect(modalSrc).toMatch(/insertKeyframeAt\(prev, at\)/);
    expect(modalSrc).toMatch(/removeKeyframeAt\(prev, index\)/);
    expect(modalSrc).toMatch(/retimeKeyframe\(prev, index, at\)/);
    expect(modalSrc).toMatch(/setKeyframeComponent\(prev, index, key, value\)/);
    expect(modalSrc).toMatch(/setSegmentEasing\(prev, index, easing\)/);
    // The one thing that would break D31: assigning `keyframes` directly.
    expect(modalSrc).not.toMatch(/keyframes: \[/);
  });

  it('parks the playhead on the edited keyframe through the D44 conversion', () => {
    expect(modalSrc).toMatch(/atToScrub\(list\[clamped\]\.at, window\.start, window\.duration, clipDuration\)/);
    expect(modalSrc).toMatch(/setStagePlaying\(false\)/);
  });

  it('refuses to close while a drag owns the pointer (R33)', () => {
    expect(modalSrc).toMatch(/if \(draggingRef\.current\) return;/);
  });
});

/**
 * C23 — the write gate, verified mechanically rather than by a one-off grep in
 * a design document.
 *
 * The D31 mirror (`keyframes[0] ≡ start`, `keyframes[n-1] ≡ end`) is what lets
 * every pre-curve code path — an older client, an older project file, the
 * collapsed export branch — still read a correct straight-line motion. It holds
 * only because `normalizeCameraKeyframes` re-establishes it after EVERY write.
 * One assignment that skips the gate and the guarantee is gone silently, so the
 * rule is scanned instead of trusted.
 */
describe('C23 — the write gate is mechanically verifiable', () => {
  const cameraDir = resolve(dir, '..', '..', 'playback', 'camera');
  const read = (name: string) => readFileSync(resolve(cameraDir, name), 'utf-8');

  it('every store-bound `keyframes:` assignment passes through the gate', () => {
    // The complete allow-list, with the reason each one is legitimate.
    const allowed: Array<[string, RegExp]> = [
      // The gate's own output.
      ['keyframes.ts', /keyframes: next,/],
      // The panel's shared exit — wrapped in the gate.
      ['keyframes.ts', /return normalizeCameraKeyframes\(\{ \.\.\.motion, presetId: 'custom', keyframes: stops \}\)/],
      // Reverse's curve branch — wrapped in the gate.
      ['cameraPresets.ts', /return normalizeCameraKeyframes\(\{ \.\.\.motion, presetId: 'custom', keyframes: reversed \}\)/],
      // Project-JSON load — normalized on the very next line.
      ['wire.ts', /\.\.\.\(stops \? \{ keyframes: stops \} : \{\}\),/],
      // Outbound wire object; a DIFFERENT type (snake_case), not a store write.
      ['wire.ts', /\? \{ keyframes: stops\.map\(\(stop\) => toStopWire\(stop, mode\)\) \}/],
    ];
    allowed.forEach(([file, pattern]) => {
      expect(read(file), `${file} ${pattern}`).toMatch(pattern);
    });

    // …and nothing else in the camera module assigns the field at all.
    const files = ['keyframes.ts', 'cameraPresets.ts', 'wire.ts', 'easing.ts',
      'identity.ts', 'fingerprint.ts', 'splitRebase.ts', 'resolveCameraDraw.ts',
      'cameraGeometry.ts', 'eligibility.ts'];
    const total = files.reduce((count, file) => {
      const body = read(file).replace(/^\s*\*.*$/gm, '');   // drop doc comments
      return count + (body.match(/\bkeyframes:\s/g) ?? []).length;
    }, 0);
    // Exactly the allow-list. Optional-property DECLARATIONS spell it
    // `keyframes?:` and are not counted, which is what makes this a count of
    // writes rather than of mentions.
    expect(total).toBe(allowed.length);
  });

  it('sanitizeCameraMotion normalizes what it just parsed', () => {
    expect(read('wire.ts')).toMatch(/return normalizeCameraKeyframes\(parsed\);/);
  });

  it('the panel never assembles a keyframes array itself', () => {
    expect(modalSrc).not.toMatch(/keyframes: \[/);
    expect(stripSrc).not.toMatch(/keyframes:/);
    expect(overlaySrc).not.toMatch(/keyframes:/);
  });
});
