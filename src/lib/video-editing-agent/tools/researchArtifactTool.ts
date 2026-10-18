import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { executeWebTool } from './webToolAdapter';

const parameters = Type.Object({ artifact_id: Type.String({ format: 'uuid' }),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  max_bytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 8000 })),
}, { additionalProperties: false });

export function createResearchArtifactTool(context: ToolContext): AgentTool<typeof parameters> {
  return { name: 'read_research_artifact', label: 'read_research_artifact',
    description: 'Read stored research evidence using artifact_id and the previous next_offset (UTF-8 bytes). Never changes editor state.',
    parameters, execute: (id, params) => executeWebTool(context, id, {
      path: `/artifacts/${params.artifact_id}?offset=${params.offset ?? 0}&max_bytes=${params.max_bytes ?? 4000}`,
      method: 'GET', timeout: 5000,
    }) };
}
