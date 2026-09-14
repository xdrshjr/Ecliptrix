/**
 * @vitest-environment node
 *
 * CameraMotionModal — panel contract (spec §4.5.2 / §9.1, acceptance A1 / A10 / A15).
 *
 * Source-level assertions, matching the project pattern in
 * PreviewCanvas.test.tsx / ProjectCard.test.tsx: this repo's tsconfig uses
 * `jsx: "preserve"`, so vitest's rolldown/vite transform cannot mount component
 * JSX (importing any .tsx for render fails import analysis). We therefore pin
 * the panel's contract at the source level, and cover the BEHAVIOUR it delegates
 * to with real unit tests against the pure modules (presets / identity /
 * reverse / geometry) below.
 *
 * What is pinned here:
 *  - a11y: Modal's required `labelledBy` + `describedBy`, a real radiogroup with
 *    aria-checked and roving tabindex, arrow-key navigation;
 *  - non-invasive editing: the draft lives in local state and only `Apply`
 *    calls `onApply`, so Cancel is a true cancel;
 *  - the batch checkbox narrows the target list;
 *  - the stage reuses `resolveCameraDraw` / `Camera3DRenderer` rather than
 *    re-implementing the draw (R12);
 *  - `prefers-reduced-motion` is honoured.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyPreset, emptyCameraMotion, reverseCameraMotion } from '../../../playback/camera/cameraPresets';
import { isIdentityCameraMotion } from '../../../playback/camera/identity';
import { resolveCameraDraw } from '../../../playback/camera/resolveCameraDraw';
import { _clearCameraConstantsCache } from '../../../playback/camera/cameraGeometry';

const dir = resolve(__dirname, '..');
const modalSrc = readFileSync(resolve(dir, 'CameraMotionModal.tsx'), 'utf-8');
const gridSrc = readFileSync(resolve(dir, 'PresetGrid.tsx'), 'utf-8');
const stageSrc = readFileSync(resolve(dir, 'MotionPreviewStage.tsx'), 'utf-8');
const controlsSrc = readFileSync(resolve(dir, 'ParameterControls.tsx'), 'utf-8');

describe('CameraMotionModal — a11y contract (A1 / A10)', () => {
  it('passes Modal its required labelledBy plus a describedBy', () => {
    expect(modalSrc).toMatch(/labelledBy=\{TITLE_ID\}/);
    expect(modalSrc).toMatch(/describedBy=\{DESC_ID\}/);
    expect(modalSrc).toMatch(/id=\{TITLE_ID\}/);
    expect(modalSrc).toMatch(/id=\{DESC_ID\}/);
  });

  it('names the panel and the clip it is editing', () => {
    expect(modalSrc).toMatch(/labels\.title/);
    expect(modalSrc).toMatch(/labels\.clipLabel\.replace\('\{name\}', clipName\)/);
  });

  it('renders the 2D / 3D switch as a real tablist', () => {
    expect(modalSrc).toMatch(/role="tablist"/);
    expect(modalSrc.match(/role="tab"/g) ?? []).toHaveLength(2);
    expect(modalSrc).toMatch(/aria-selected=\{mode === '2d'\}/);
    expect(modalSrc).toMatch(/aria-selected=\{mode === '3d'\}/);
  });

  it('builds the preset picker as a radiogroup with roving tabindex', () => {
    expect(gridSrc).toMatch(/role="radiogroup"/);
    expect(gridSrc).toMatch(/role="radio"/);
    expect(gridSrc).toMatch(/aria-checked=\{checked\}/);
    expect(gridSrc).toMatch(/tabIndex=\{index === activeIndex \? 0 : -1\}/);
  });

  it('moves the selection with the arrow keys, wrapping at both ends', () => {
    expect(gridSrc).toMatch(/ArrowRight/);
    expect(gridSrc).toMatch(/ArrowLeft/);
    expect(gridSrc).toMatch(/ArrowUp/);
    expect(gridSrc).toMatch(/ArrowDown/);
    expect(gridSrc).toMatch(/\(activeIndex \+ step \+ ids\.length\) % ids\.length/);
  });

  it('gives the intensity slider a human-readable value text', () => {
    expect(controlsSrc).toMatch(/aria-valuetext=\{labels\.intensityValue/);
  });

  it('labels the reverse button explicitly', () => {
    expect(controlsSrc).toMatch(/aria-label=\{labels\.reverseAria\}/);
  });

  it('marks the decorative preset diagrams aria-hidden', () => {
    expect(gridSrc).toMatch(/aria-hidden="true"/);
  });
});

describe('CameraMotionModal — non-invasive editing', () => {
  it('keeps the draft in local state and never touches the store', () => {
    expect(modalSrc).toMatch(/const \[draft, setDraft\] = useState<CameraMotion>/);
    expect(modalSrc).not.toMatch(/useTimelineStore/);
    expect(modalSrc).not.toMatch(/setCameraMotionAction/);
  });

  it('calls onApply only from the Apply button, then closes', () => {
    expect(modalSrc).toMatch(/const handleApply = useCallback\(\(\) => \{\s*\n\s*onApply\(itemIds, isNone \? null : draft\);\s*\n\s*onClose\(\);/);
    expect(modalSrc).toMatch(/onClick=\{handleApply\}/);
  });

  it('confirms before discarding unapplied edits', () => {
    // In-app ConfirmationDialog, not the blocking native confirm (UI3-07);
    // behaviour is covered by CameraMotionModal.discard.test.tsx.
    expect(modalSrc).toMatch(/const handleRequestClose/);
    expect(modalSrc).toMatch(/if \(isDirty\) \{\s*\n\s*setIsDiscardConfirmOpen\(true\);/);
    expect(modalSrc).not.toMatch(/window\.confirm/);
  });

  it('re-seeds the draft from the live item every time it opens', () => {
    expect(modalSrc).toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(!isOpen\) return;/);
    expect(modalSrc).toMatch(/setDraft\(seed\)/);
  });

  it('narrows the target list when the batch checkbox is off', () => {
    expect(modalSrc).toMatch(/applyToAll \? targetItemIds : targetItemIds\.slice\(0, 1\)/);
    expect(modalSrc).toMatch(/checked=\{applyToAll\}/);
  });

  it('flips presetId to custom on any advanced-field edit', () => {
    // The flip itself moved into `setKeyframeComponent` when curves arrived
    // (C23: one write gate for keyframe data, so the panel cannot get it wrong
    // in one branch and right in another). What this test now pins is that the
    // number inputs really do route through that gate rather than assembling a
    // motion object of their own.
    expect(controlsSrc).toMatch(/onKeyframeComponent\(/);
    expect(controlsSrc).not.toMatch(/\[edge\]: \{ \.\.\.motion\[edge\]/);
    const gateSrc = readFileSync(
      resolve(dir, '..', '..', 'playback', 'camera', 'keyframes.ts'), 'utf-8',
    );
    expect(gateSrc).toMatch(/presetId: 'custom'/);
    expect(gateSrc).toMatch(/export function setKeyframeComponent/);
  });
});

describe('CameraMotionModal — stage reuses the shared math (R12)', () => {
  it('renders the stage through resolveCameraDraw, not a private copy', () => {
    expect(stageSrc).toMatch(/resolveCameraDraw\(/);
    expect(stageSrc).toMatch(/Camera3DRenderer/);
    expect(stageSrc).toMatch(/fallbackCropForDraw\(/);
  });

  it('reproduces the D13 draw contract (rollPad destination + clip + rotate)', () => {
    expect(stageSrc).toMatch(/const rollPad = camera\.rollPad > 1 \? camera\.rollPad : 1/);
    expect(stageSrc).toMatch(/ctx\.clip\(\)/);
    expect(stageSrc).toMatch(/ctx\.rotate\(\(camera\.roll \* Math\.PI\) \/ 180\)/);
  });

  it('honours prefers-reduced-motion in the panel and the stage', () => {
    expect(modalSrc).toMatch(/prefers-reduced-motion: reduce/);
    // The stage no longer owns this: reduced motion now means "open paused at
    // the midpoint", which is the transport state the panel seeds (§4.5.2).
    expect(modalSrc).toMatch(/useState\(!reducedMotion\)/);
    expect(modalSrc).toMatch(/useState\(reducedMotion \? 0\.5 : 0\)/);
    expect(gridSrc).toMatch(/reducedMotion \? undefined : PRESET_ANIMATION\[presetId\]/);
  });

  it('scrubs with a real range input that announces its position (A27)', () => {
    expect(stageSrc).toMatch(/type="range"/);
    expect(stageSrc).toMatch(/aria-label=\{labels\.scrub\}/);
    expect(stageSrc).toMatch(/aria-valuetext=\{valueText\(labels\.scrubValue/);
    // A native range gives keyboard stepping for free — precise inspection must
    // not depend on mouse accuracy.
    expect(stageSrc).toMatch(/step=\{0\.005\}/);
  });

  it('pauses the loop as soon as the user drags (A27)', () => {
    expect(modalSrc).toMatch(/const handleStageScrub = useCallback\(\(u: number\) => \{\s*\n\s*setStagePlaying\(false\);\s*\n\s*setStageProgress\(u\);/);
    expect(stageSrc).toMatch(/onChange=\{handleScrub\}/);
  });

  it('animates the playhead without re-rendering the panel each frame', () => {
    // The slider is uncontrolled and written from the draw loop; a 60Hz
    // setState here would re-render the whole panel around the canvas.
    expect(stageSrc).toMatch(/defaultValue=\{clamp01\(progress\)\}/);
    expect(stageSrc).toMatch(/writeScrubPosition\(u\)/);
    expect(stageSrc).not.toMatch(/setState/);
  });

  it('resets the transport every time the panel opens', () => {
    expect(modalSrc).toMatch(/setStagePlaying\(!reducedMotion\)/);
    expect(modalSrc).toMatch(/setStageProgress\(reducedMotion \? 0\.5 : 0\)/);
  });

  it('shows the WebGL-degraded badge only in 3D', () => {
    expect(modalSrc).toMatch(/mode === '3d' && webglDegraded/);
    expect(modalSrc).toMatch(/labels\.webglDegraded/);
  });

  it('stands the preview badge down while the panel is open (D29)', () => {
    // Two near-identical sentences with different trigger conditions is worse
    // than one: the user cannot tell whether they are the same thing.
    expect(modalSrc).toMatch(/markCameraMotionPanelOpen\(\)/);
    const badgeSrc = readFileSync(
      resolve(dir, '../VideoPlayerPanel/CameraDegradeBadge.tsx'),
      'utf-8',
    );
    expect(badgeSrc).toMatch(/subscribeCameraMotionPanel/);
    expect(badgeSrc).toMatch(/if \(!degraded \|\| dismissed \|\| suppressed\) return null/);
    // The half-sentence the badge exists for.
    expect(badgeSrc).toMatch(/labels\.degradedBadge/);
    expect(badgeSrc).toMatch(/role="status"/);
    expect(badgeSrc).toMatch(/aria-live="polite"/);
  });

  it('raises the three quality hints from real measurements, not guesses', () => {
    expect(modalSrc).toMatch(/constants\.coverScale > 1\.6/);
    expect(modalSrc).toMatch(/constants\.rollPad > 1\.2/);
    expect(modalSrc).toMatch(/hasClampedComponent\(draft\)/);
  });
});

describe('panel behaviour delegated to the pure modules', () => {
  it('"None" resolves to no motion, so Apply writes null', () => {
    expect(isIdentityCameraMotion(emptyCameraMotion('2d'))).toBe(true);
    expect(isIdentityCameraMotion(emptyCameraMotion('3d'))).toBe(true);
  });

  it('every preset card produces a non-identity motion', () => {
    ['push-in', 'pull-out', 'pan-left', 'roll-slight', 'orbit-left', 'sway-3d'].forEach((id) => {
      const mode = id.includes('orbit') || id.includes('3d') ? '3d' : '2d';
      expect(isIdentityCameraMotion(applyPreset(id, mode as '2d' | '3d'))).toBe(false);
    });
  });

  it('Reverse swaps the endpoints and drops the preset identity', () => {
    const reversed = reverseCameraMotion(applyPreset('push-in', '2d'));
    expect(reversed.presetId).toBe('custom');
    expect(reversed.start.scale).toBeCloseTo(1.25, 6);
    expect(reversed.end.scale).toBeCloseTo(1, 6);
  });

  it('pull-out at intensity 0 stays a static 1.25× framing (A15)', () => {
    _clearCameraConstantsCache();
    const motion = { ...applyPreset('pull-out', '2d'), intensity: 0 };
    expect(isIdentityCameraMotion(motion)).toBe(false);
    const draw = resolveCameraDraw(motion, 3, 6, 16 / 9);
    expect(draw!.crop.w).toBeCloseTo(1 / 1.25, 9);
  });

  it('an unknown preset id falls back to a neutral motion instead of throwing', () => {
    expect(isIdentityCameraMotion(applyPreset('does-not-exist', '2d'))).toBe(true);
  });
});
