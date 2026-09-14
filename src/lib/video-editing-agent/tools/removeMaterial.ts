import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { findTimelineUsages } from '@/components/video/timeline/lib/materialUsage';

const parameters = Type.Object({
  material_id: Type.String({ description: 'ID of the material to remove from the library' }),
});
type Params = Static<typeof parameters>;

function textResult(details: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
}

export function createRemoveMaterialTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'remove_material',
    label: 'Remove Material',
    description:
      'Remove a material from the material library. Refused while clips on the timeline still use the material ' +
      '(the result lists them in usedByClipIds): delete those clips with delete_clip first.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const materialId = params.material_id;

      // Check if material exists in the context array.
      const index = context.materials.findIndex(m => m.id === materialId);
      if (index === -1) {
        return textResult({ success: false, error: `Material not found: ${materialId}` });
      }

      // Removing a used material would silently break those clips in preview,
      // image overlays and audio export, and the removal cannot be undone.
      const usedByClipIds = findTimelineUsages(context.timelineState.tracks, [materialId])[0]?.itemIds ?? [];
      if (usedByClipIds.length > 0) {
        return textResult({
          success: false,
          error: 'Material is used by clips on the timeline; delete those clips first',
          usedByClipIds,
        });
      }

      // Capture the name before removing (splice invalidates the lookup).
      const materialName = context.materials[index].name;

      // Remove from the live context array so subsequent tools in the same
      // turn see an up-to-date material list.
      context.materials.splice(index, 1);

      // Record operation for client-side store update via SSE
      context.recordOperation(toolCallId, { type: 'remove_material', materialId });

      return textResult({ success: true, message: `Material "${materialName}" removed from library.` });
    },
  };
}
