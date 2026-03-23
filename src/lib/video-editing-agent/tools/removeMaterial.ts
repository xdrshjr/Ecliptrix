import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';

const parameters = Type.Object({
  material_id: Type.String({ description: 'ID of the material to remove from the library' }),
});
type Params = Static<typeof parameters>;

export function createRemoveMaterialTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'remove_material',
    label: 'Remove Material',
    description:
      'Remove a material from the material library. Does not affect clips already on the timeline. Returns a warning if the material is referenced by timeline clips.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const materialId = params.material_id;

      // Check if material exists in the context array.
      const index = context.materials.findIndex(m => m.id === materialId);
      if (index === -1) {
        const err = { success: false, message: `Material not found: ${materialId}` };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // Check if any timeline clip references this material.
      const referencingClipIds: string[] = [];
      for (const track of context.timelineState.tracks) {
        for (const item of track.items) {
          if (item.materialId === materialId) {
            referencingClipIds.push(item.id);
          }
        }
      }

      // Capture the name before removing (splice invalidates the lookup).
      const materialName = context.materials[index].name;

      // Remove from the live context array so subsequent tools in the same
      // turn see an up-to-date material list.
      context.materials.splice(index, 1);

      // Record operation for client-side store update via SSE
      context.recordOperation(toolCallId, { type: 'remove_material', materialId });

      let message = `Material "${materialName}" removed from library.`;
      if (referencingClipIds.length > 0) {
        message += ` Warning: ${referencingClipIds.length} timeline clip(s) still reference this material (${referencingClipIds.join(', ')}).`;
      }

      const result = { success: true, message };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
