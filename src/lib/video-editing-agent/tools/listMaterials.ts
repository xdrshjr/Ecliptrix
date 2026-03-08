import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { serializeMaterial } from './index';

const parameters = Type.Object({
  type: Type.Optional(
    Type.Union([
      Type.Literal('video'),
      Type.Literal('image'),
      Type.Literal('audio'),
      Type.Literal('subtitle'),
    ], { description: 'Filter by material type. If omitted, lists all materials.' })
  ),
});
type Params = Static<typeof parameters>;

export function createListMaterialsTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'list_materials',
    label: 'List Materials',
    description:
      'List all materials in the material library. Optionally filter by type. Use this to see what materials are available before adding them to the timeline.',
    parameters,

    execute: async (_toolCallId, params: Params) => {
      const typeFilter = params.type;

      const filtered = typeFilter
        ? context.materials.filter(m => m.type === typeFilter)
        : context.materials;

      const result = {
        success: true,
        count: filtered.length,
        materials: filtered.map(m => serializeMaterial(m)),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
