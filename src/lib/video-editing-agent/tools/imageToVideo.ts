import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { runStillClip, stillToolResponse } from './stillClip';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export const stillEffectSchema = Type.Optional(
  Type.Union(
    [Type.Literal('ken_burns'), Type.Literal('pan'), Type.Literal('static')],
    { description: 'Default ken_burns (slow push). pan = horizontal drift. static = no motion' },
  ),
);

export const stillDirectionSchema = Type.Optional(
  Type.Union(
    [
      Type.Literal('zoom_in'), Type.Literal('zoom_out'),
      Type.Literal('left_to_right'), Type.Literal('right_to_left'),
    ],
    { description: 'ken_burns: zoom_in|zoom_out (default zoom_in). pan: left_to_right|right_to_left (default left_to_right)' },
  ),
);

export const stillAspectRatioSchema = Type.Optional(
  Type.Union(
    [
      Type.Literal('16:9'), Type.Literal('9:16'), Type.Literal('1:1'),
      Type.Literal('4:3'), Type.Literal('21:9'),
    ],
    { description: 'Output frame. Omit to keep the image own ratio. Pass the project ratio when known' },
  ),
);

const parameters = Type.Object({
  material_id: Type.String({
    description: 'Image material id from list_materials / search_image / generate_ai_image',
  }),
  duration: Type.Optional(Type.Number({
    minimum: 1, maximum: 30,
    description: 'Seconds, default 5. Slideshow shots: 3-5; match narration length when known',
  })),
  effect: stillEffectSchema,
  direction: stillDirectionSchema,
  focus_x: Type.Optional(Type.Number({
    minimum: 0, maximum: 1, description: 'Subject centre, 0=left 1=right, default 0.5',
  })),
  focus_y: Type.Optional(Type.Number({
    minimum: 0, maximum: 1, description: 'Subject centre, 0=top 1=bottom, default 0.5',
  })),
  aspect_ratio: stillAspectRatioSchema,
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createImageToVideoTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'image_to_video',
    label: 'Image to Video',
    description:
      'Turn ONE image material into a full-frame video clip (slow push / pan / static), locally and free. ' +
      'Returns a video materialId — pass it to add_to_track. Repeating the same call returns the same clip. ' +
      'For several images use batch_image_to_video.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const { result, addedMaterial } = await runStillClip(context, params);
      if (addedMaterial) {
        context.recordOperation(toolCallId, { type: 'add_material', material: addedMaterial });
      }
      return stillToolResponse(result);
    },
  };
}
