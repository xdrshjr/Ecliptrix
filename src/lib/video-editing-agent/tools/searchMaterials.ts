import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';

const parameters = Type.Object({
  query: Type.String({ description: 'Search keyword to match material names' }),
  type: Type.Optional(
    Type.Union([
      Type.Literal('video'),
      Type.Literal('image'),
      Type.Literal('audio'),
      Type.Literal('subtitle'),
    ], { description: 'Filter by material type. If omitted, searches all types.' })
  ),
});
type Params = Static<typeof parameters>;

export function createSearchMaterialsTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'search_materials',
    label: 'Search Materials',
    description:
      'Search the material library for videos, images, or audio files. Returns matching materials that can be added to the timeline.',
    parameters,

    execute: async (_toolCallId, params: Params) => {
      const query = params.query.toLowerCase();
      const typeFilter = params.type;

      const matches = context.materials.filter(m =>
        m.name.toLowerCase().includes(query) &&
        (!typeFilter || m.type === typeFilter)
      );

      const result = {
        success: true,
        count: matches.length,
        materials: matches.map(m => ({
          id: m.id,
          name: m.name,
          type: m.type,
          duration: m.duration,
          thumbnailUrl: m.thumbnailUrl,
        })),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
