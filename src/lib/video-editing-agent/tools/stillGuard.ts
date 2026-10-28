import type { MaterialItem } from '@/types';
import type { ToolkitTurnState } from '@/types/agentToolkit';

/**
 * Stable error code of the guard. `agent.ts` exempts it from the consecutive
 * failure breaker: it is a one-step self-correction, not a failing tool.
 */
export const STILL_NEEDS_CONVERSION = 'still_needs_conversion';

/**
 * Point-of-use hint (L0.5) attached to results that just put images in the
 * library - the moment the model decides what to do with them. It lives in
 * the tool result, never in the resident prompt.
 */
export const STILL_IMAGE_NEXT_STEP =
  'These are still images. To use one as a shot: image_to_video(material_id) then add_to_track(videoMaterialId); '
  + 'logos/stickers: add_to_track(as_still:true). Library only if the user did not ask to place it.';

/** Refusals of one image after which the hint turns into an order. */
export const ESCALATE_AFTER_REJECTIONS = 3;

export interface StillGuardRejection {
  success: false;
  error_code: typeof STILL_NEEDS_CONVERSION;
  error: string;
  next_step: {
    tool: 'image_to_video';
    category: 'still_tools';
    call: string;
    overlay_exception: string;
  };
}

export interface StillGuardOptions {
  /** `add_to_track({ as_still: true })`: the caller asked for an overlay. */
  allowStill?: boolean;
  turnState: ToolkitTurnState;
}

/**
 * Refuse to put a still image on the video track as a scene shot.
 *
 * A still clip renders as a draggable 80 %-size overlay, not a full-frame
 * shot; the right path is image -> video clip -> add_to_track. Every Agent
 * tool that emits `add_clip` must run this first (spec D-9): today
 * `add_to_track` and `compose_storyboard`.
 *
 * @returns `null` to proceed, otherwise the refusal to hand back to the model.
 */
export function checkStillGuard(
  material: Pick<MaterialItem, 'id' | 'name' | 'type'>,
  options: StillGuardOptions,
): StillGuardRejection | null {
  if (material.type !== 'image' || options.allowStill) return null;
  const refusals = countRefusal(options.turnState, material.id);
  const conversion = `explore_tools({category:"still_tools"}) then image_to_video({material_id:"${material.id}"}) and add_to_track the returned materialId`;
  return {
    success: false,
    error_code: STILL_NEEDS_CONVERSION,
    error: `"${material.name}" is a still image. As a scene shot it must be converted to a video clip first.`,
    next_step: {
      tool: 'image_to_video',
      category: 'still_tools',
      call: refusals >= ESCALATE_AFTER_REJECTIONS
        ? `You were refused ${refusals} times for this image. Call image_to_video now and do not retry add_to_track with the image: ${conversion}`
        : conversion,
      overlay_exception:
        'For a logo/sticker/watermark overlay call add_to_track again with as_still:true',
    },
  };
}

function countRefusal(turnState: ToolkitTurnState, materialId: string): number {
  const counts = (turnState.stillRejections ??= {});
  counts[materialId] = (counts[materialId] ?? 0) + 1;
  return counts[materialId];
}

/** True for a tool result detail produced by this guard. */
export function isStillGuardRejection(details: unknown): boolean {
  return typeof details === 'object' && details !== null
    && (details as { error_code?: unknown }).error_code === STILL_NEEDS_CONVERSION;
}
