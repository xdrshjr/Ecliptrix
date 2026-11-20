/**
 * clipEffectsOperation — the single implementation of `update_clip_effects`
 * (camera motion + fade/dissolve on an existing clip).
 *
 * Shared by the browser `OperationApplier` and the server-side
 * `agent.ts::applyOperationLocally`, the same way `subtitleClips.ts` is: two
 * copies of this rule would drift, and the server mirror would then report
 * success for something the client refuses.
 *
 * Pure: no React, DOM or store access. The camera import is the DOM-free
 * `wire.ts` (the `playback/camera` barrel also pulls the WebGL renderer, which
 * must not reach a Next route module).
 */

import type {
  ClipTransition,
  TimelineItem,
  TimelineState,
  Track,
  UpdateClipEffectsOperation,
} from '@/types';
import { sanitizeCameraMotion } from '@/components/video/playback/camera/wire';

const TRANSITION_TYPES: ReadonlyArray<ClipTransition['type']> = ['fade', 'dissolve'];
const EFFECT_FIELDS = ['cameraMotion', 'transitionIn', 'transitionOut'] as const;

/**
 * Whether a clip can carry camera motion / transitions: a clip on an unlocked
 * video track whose own type is `video` (image stills dropped on a video track
 * keep `type: 'video'`). Same value as `cameraMotionIneligibleReason` in
 * `playback/camera/eligibility.ts`, restated over the agent-side types;
 * `clipEffectsOperation.test.ts` pins the two together.
 */
export function isClipEffectsEligible(track: Track, item: TimelineItem): boolean {
  return track.type === 'video' && item.type === 'video' && !track.isLocked;
}

/** Why a `ClipTransition` is unusable, or `null` when it is well formed. */
export function transitionProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'transition must be an object';
  const { type, duration } = value as Partial<ClipTransition>;
  if (!type || !TRANSITION_TYPES.includes(type)) {
    return `transition type must be one of ${TRANSITION_TYPES.join(', ')}`;
  }
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return 'transition duration must be a positive number of seconds';
  }
  return null;
}

/**
 * First problem with the payload itself (not with the clip it targets), or
 * `null`. At least one effect field must be present; `null` always clears.
 */
export function clipEffectsPayloadProblem(
  operation: UpdateClipEffectsOperation,
): string | null {
  const present = EFFECT_FIELDS.filter(field => operation[field] !== undefined);
  if (present.length === 0) return 'no effect field given';
  if (operation.cameraMotion && !sanitizeCameraMotion(operation.cameraMotion)) {
    return 'cameraMotion is not a valid camera motion';
  }
  for (const field of ['transitionIn', 'transitionOut'] as const) {
    const value = operation[field];
    const problem = value ? transitionProblem(value) : null;
    if (problem) return `${field}: ${problem}`;
  }
  return null;
}

/** The clip and its track, or `undefined` when the id is not on the timeline. */
export function findClipWithTrack(
  state: TimelineState,
  clipId: string,
): { track: Track; item: TimelineItem } | undefined {
  for (const track of state.tracks) {
    const item = track.items.find(candidate => candidate.id === clipId);
    if (item) return { track, item };
  }
  return undefined;
}

/**
 * Write the operation onto its clip. Absent field = untouched, `null` = clear.
 * Never moves or resizes anything: `startTime` / `duration` stay bit-identical,
 * which the caller's reconcile pass relies on.
 */
export function applyClipEffectsToState(
  state: TimelineState,
  operation: UpdateClipEffectsOperation,
): void {
  const found = findClipWithTrack(state, operation.clipId);
  if (!found) return;
  const { item } = found;
  if (operation.cameraMotion === null) delete item.cameraMotion;
  else if (operation.cameraMotion) item.cameraMotion = sanitizeCameraMotion(operation.cameraMotion);
  if (operation.transitionIn === null) delete item.transitionIn;
  else if (operation.transitionIn) item.transitionIn = { ...operation.transitionIn };
  if (operation.transitionOut === null) delete item.transitionOut;
  else if (operation.transitionOut) item.transitionOut = { ...operation.transitionOut };
}
