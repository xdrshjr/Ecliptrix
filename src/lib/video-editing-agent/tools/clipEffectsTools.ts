import { Type, type Static, type TSchema } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { CameraEasing, ClipTransition, UpdateClipEffectsOperation } from '@/types';
import { applyPreset, CAMERA_PRESETS, findPreset } from '@/components/video/playback/camera/cameraPresets';
import { CAMERA_INTENSITY_RANGE } from '@/components/video/playback/camera/types';
import { sanitizeCameraMotion } from '@/components/video/playback/camera/wire';
import type { ToolContext } from '../types';
import { findLockedTrackId, validateOperationTargets } from '../operationGuards';
import { findClipWithTrack } from '../clipEffectsOperation';
import { toolErrorResponse, type ToolErrorResult } from './index';

/**
 * `clip_effects` category: parameter-type effects on clips already on the
 * timeline. Camera motion and fade/dissolve cost nothing to render — preview
 * and export read the same clip fields — so they are NOT Remotion templates
 * (effects_tools). Both tools end in one `update_clip_effects` operation per
 * clip and put the whole array in `result.operations`: a single
 * `updateTimeline` call is last-wins per toolCallId, which would drop every
 * clip but the last one.
 */

const MAX_CLIPS_PER_CALL = 12;
const CAMERA_EASINGS: readonly CameraEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
const TRANSITION_TYPES: readonly ClipTransition['type'][] = ['fade', 'dissolve'];

/** `presetId` values come from the preset table itself, never a hand copy. */
const PRESET_IDS = ['none', ...CAMERA_PRESETS.map(preset => preset.id)];

function literalUnion(values: readonly string[]): TSchema {
  return Type.Union(values.map(value => Type.Literal(value)));
}

const cameraParameters = Type.Object({
  clipIds: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: MAX_CLIPS_PER_CALL,
    description: 'IDs of the video/image clips (from get_timeline) to move the camera on.',
  }),
  presetId: Type.Unsafe<string>({
    ...literalUnion(PRESET_IDS),
    description: 'Camera move; "none" clears the clip. 2D: push-in, pull-out, pan-*, zoom-pan-diagonal, roll-slight. 3D: dolly-*, orbit-*, tilt-*, parallax-push, sway-3d.',
  }),
  intensity: Type.Optional(Type.Number({
    minimum: CAMERA_INTENSITY_RANGE.min,
    maximum: CAMERA_INTENSITY_RANGE.max,
    description: 'Strength multiplier 0-2 (default 1; 0 holds the start frame).',
  })),
  easing: Type.Optional(Type.Unsafe<CameraEasing>({
    ...literalUnion(CAMERA_EASINGS),
    description: 'Speed curve (default easeInOut).',
  })),
}, { additionalProperties: false });

const transitionSchema = Type.Union([
  Type.Object({
    type: Type.Unsafe<ClipTransition['type']>(literalUnion(TRANSITION_TYPES)),
    duration: Type.Number({ description: 'Seconds, > 0; capped at half the clip.' }),
  }, { additionalProperties: false }),
  Type.Null(),
], { description: 'Object to set, null to clear, omit to leave unchanged.' });

const transitionParameters = Type.Object({
  clipId: Type.String({ description: 'ID of the video/image clip (from get_timeline).' }),
  transitionIn: Type.Optional(transitionSchema),
  transitionOut: Type.Optional(transitionSchema),
}, { additionalProperties: false });

type CameraParams = Static<typeof cameraParameters>;
type TransitionParams = Static<typeof transitionParameters>;

interface Refusal { clipId: string; reason: string }

const REFUSAL_TEXT: Record<string, string> = {
  'clip-not-found': 'clip not found on the timeline',
  'track-not-found': 'track not found',
  'target-track-missing': 'only clips on a video track can take camera motion or transitions',
  'invalid-time': 'invalid effect values',
  'locked-track': 'the track is locked; ask the user to unlock it',
};

function textResponse(result: object) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result };
}

/**
 * Check every operation against the live timeline with the SAME guards the
 * server mirror and the browser applier run, so nothing is applied when any
 * clip would be refused (all-or-nothing, like the client batch).
 */
function findRefusals(context: ToolContext, operations: UpdateClipEffectsOperation[]): Refusal[] {
  const refusals: Refusal[] = [];
  for (const operation of operations) {
    const validation = validateOperationTargets(context.timelineState, operation);
    if (!validation.ok) {
      refusals.push({ clipId: operation.clipId, reason: REFUSAL_TEXT[validation.reason] ?? validation.reason });
      continue;
    }
    if (findLockedTrackId(context.timelineState, operation) !== null) {
      refusals.push({ clipId: operation.clipId, reason: REFUSAL_TEXT['locked-track'] });
    }
  }
  return refusals;
}

/** Apply the checked operations to the local mirror; the batch rides in `result.operations`. */
function commit(
  context: ToolContext,
  toolCallId: string,
  operations: UpdateClipEffectsOperation[],
): ToolErrorResult | null {
  for (const operation of operations) {
    const receipt = context.updateTimeline(toolCallId, operation);
    if (receipt && !receipt.applied) {
      return {
        success: false,
        error_code: 'clip_effects_apply_refused',
        error: `The timeline refused the change to ${operation.clipId} (${receipt.reason}). Call get_timeline and retry.`,
      };
    }
  }
  return null;
}

function refusalResponse(refusals: Refusal[]) {
  return toolErrorResponse({
    success: false,
    error_code: 'clip_effects_refused',
    failureClass: 'user_input',
    error: `No clip was changed: ${refusals.map(item => `${item.clipId} (${item.reason})`).join('; ')}.`,
    next_step: 'Fix or drop the listed clips (get_timeline shows ids, track types and locks), then call again.',
  });
}

function createSetCameraMotionTool(context: ToolContext): AgentTool<typeof cameraParameters> {
  return {
    name: 'set_camera_motion',
    label: 'Set Camera Motion',
    description:
      'Instant, no render: give up to 12 existing video/image clips a camera move (push, pull, pan, 3D orbit/dolly/tilt). ' +
      'presetId "none" clears it. All-or-nothing: if any clip is refused (missing, locked, audio/subtitle) none changes. ' +
      'Does not move or resize clips. Do it after the cut is final and after apply_effect.',
    parameters: cameraParameters,

    execute: async (toolCallId: string, params: CameraParams) => {
      const preset = params.presetId === 'none' ? null : findPreset(params.presetId);
      if (params.presetId !== 'none' && !preset) {
        return toolErrorResponse({
          success: false,
          error_code: 'unknown_camera_preset',
          failureClass: 'user_input',
          error: `Unknown presetId "${params.presetId}". Valid: ${PRESET_IDS.join(', ')}.`,
        });
      }
      const clipIds = Array.from(new Set(params.clipIds));
      const cameraMotion = preset ? buildCameraMotion(params, preset.id, preset.mode) : null;
      if (preset && !cameraMotion) {
        return toolErrorResponse({ success: false, error_code: 'invalid_camera_motion', error: 'Camera motion could not be built.' });
      }
      const operations = clipIds.map((clipId): UpdateClipEffectsOperation =>
        ({ type: 'update_clip_effects', clipId, cameraMotion }));

      const refusals = findRefusals(context, operations);
      if (refusals.length > 0) return refusalResponse(refusals);
      const failure = commit(context, toolCallId, operations);
      if (failure) return toolErrorResponse(failure);

      return textResponse({
        success: true,
        operations,
        clips: clipIds.map(id => ({ id, name: findClipWithTrack(context.timelineState, id)?.item.name })),
        camera: cameraMotion
          ? { presetId: cameraMotion.presetId, mode: cameraMotion.mode, intensity: cameraMotion.intensity, easing: cameraMotion.easing }
          : 'cleared',
        message: cameraMotion
          ? `Camera move "${params.presetId}" set on ${clipIds.length} clip(s); preview and export both use it.`
          : `Camera move cleared on ${clipIds.length} clip(s).`,
      });
    },
  };
}

function buildCameraMotion(params: CameraParams, presetId: string, mode: '2d' | '3d') {
  const motion = applyPreset(presetId, mode);
  if (params.intensity !== undefined) motion.intensity = params.intensity;
  if (params.easing !== undefined) motion.easing = params.easing;
  // The import gate also clamps intensity to its range.
  return sanitizeCameraMotion(motion);
}

/** Transition capped to half the clip, as the export (`_effective_transition_duration`) does. */
function clampTransition(transition: ClipTransition | null | undefined, clipDuration: number) {
  if (!transition) return { value: transition, clamped: false };
  const cap = clipDuration / 2;
  const duration = Math.min(transition.duration, cap);
  return {
    value: { type: transition.type, duration } satisfies ClipTransition,
    clamped: duration < transition.duration,
  };
}

function createSetClipTransitionTool(context: ToolContext): AgentTool<typeof transitionParameters> {
  return {
    name: 'set_clip_transition',
    label: 'Set Clip Transition',
    description:
      'Instant, no render: fade or dissolve a clip in and/or out (transitionIn / transitionOut = {type: fade|dissolve, duration}; null clears; omitted stays). ' +
      'Both types fade the clip\'s own alpha at its start/end (no overlap with neighbours); duration is capped at half the clip. ' +
      'Video/image clips on an unlocked video track only.',
    parameters: transitionParameters,

    execute: async (toolCallId: string, params: TransitionParams) => {
      if (params.transitionIn === undefined && params.transitionOut === undefined) {
        return toolErrorResponse({
          success: false,
          error_code: 'clip_effects_empty',
          failureClass: 'user_input',
          error: 'Give transitionIn and/or transitionOut ({type, duration} to set, null to clear).',
        });
      }
      const found = findClipWithTrack(context.timelineState, params.clipId);
      const duration = found?.item.duration ?? 0;
      const transitionIn = clampTransition(params.transitionIn, duration);
      const transitionOut = clampTransition(params.transitionOut, duration);
      const operation: UpdateClipEffectsOperation = {
        type: 'update_clip_effects',
        clipId: params.clipId,
        ...(transitionIn.value !== undefined ? { transitionIn: transitionIn.value } : {}),
        ...(transitionOut.value !== undefined ? { transitionOut: transitionOut.value } : {}),
      };

      const refusals = findRefusals(context, [operation]);
      if (refusals.length > 0) return refusalResponse(refusals);
      const failure = commit(context, toolCallId, [operation]);
      if (failure) return toolErrorResponse(failure);

      return textResponse({
        success: true,
        operations: [operation],
        clip: { id: params.clipId, name: found?.item.name, duration },
        transitionIn: operation.transitionIn === undefined ? 'unchanged' : (operation.transitionIn ?? 'cleared'),
        transitionOut: operation.transitionOut === undefined ? 'unchanged' : (operation.transitionOut ?? 'cleared'),
        ...(transitionIn.clamped || transitionOut.clamped
          ? { note: 'Duration was capped at half the clip length.' } : {}),
      });
    },
  };
}

/** The two `clip_effects` tools. */
export function createClipEffectsTools(context: ToolContext) {
  return [createSetCameraMotionTool(context), createSetClipTransitionTool(context)];
}
