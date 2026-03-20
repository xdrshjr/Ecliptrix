import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { serializeMaterial } from './index';

const parameters = Type.Object({
  query: Type.String({ description: 'Search keyword — matches against material names, AI content descriptions, text descriptions, and transcript text' }),
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
      'Search the material library by keyword. Matches against material names, AI-generated content descriptions, text descriptions, and transcript text. Returns matching materials with their IDs, metadata, and analysis results.',
    parameters,

    execute: async (_toolCallId, params: Params) => {
      const query = params.query.toLowerCase();
      const typeFilter = params.type;

      const matches = context.materials.filter(m =>
        (m.name.toLowerCase().includes(query) ||
         m.analysisResult?.analysis?.toLowerCase().includes(query) ||
         m.description?.toLowerCase().includes(query) ||
         m.sentenceSegments?.sentences.some(s => s.text.toLowerCase().includes(query))) &&
        (!typeFilter || m.type === typeFilter)
      );

      const result = {
        success: true,
        count: matches.length,
        materials: matches.map(m => serializeMaterial(m)),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
