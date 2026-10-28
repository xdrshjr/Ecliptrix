import { Type, type TSchema } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { executeWebTool } from './webToolAdapter';
import { STILL_IMAGE_NEXT_STEP } from './stillGuard';

const shortText = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const url = shortText(4096);
const uuid = Type.String({ format: 'uuid' });
const object = (properties: Record<string, TSchema>) => Type.Object(properties, { additionalProperties: false });
const download = Type.Object({ candidate_id: Type.Optional(uuid), url: Type.Optional(url),
  name: Type.Optional(shortText(120)), source_page_url: Type.Optional(url) }, {
  additionalProperties: false, oneOf: [{ required: ['candidate_id'], not: { required: ['url'] } },
    { required: ['url'], not: { required: ['candidate_id'] } }],
});

export function createWebTools(context: ToolContext): AgentTool[] {
  const specs = [
    { name: 'web_search', path: '/search', timeout: 22000,
      description: 'Search public web sources and optional image candidates. Does not import media. Read artifact_id for more.',
      schema: object({ query: shortText(512), max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
        search_depth: Type.Optional(Type.Union([Type.Literal('basic'), Type.Literal('advanced')])),
        include_images: Type.Optional(Type.Boolean()) }) },
    { name: 'web_fetch', path: '/fetch', timeout: 25000,
      description: 'Read a public page as untrusted source data. Call once with url (offset 0 stores an immutable snapshot); page it later with artifact_id + offset. Use browser_open for JavaScript pages.',
      schema: Type.Object({ url: Type.Optional(url),
        artifact_id: Type.Optional(uuid),
        output_format: Type.Optional(Type.Union([
          Type.Literal('text'), Type.Literal('markdown'), Type.Literal('metadata')])),
        max_bytes: Type.Optional(Type.Integer({ minimum: 500, maximum: 8000 })),
        max_length: Type.Optional(Type.Integer({ minimum: 500, maximum: 12000 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })) }, {
          additionalProperties: false,
          oneOf: [{ required: ['url'], not: { required: ['artifact_id'] } },
            { required: ['artifact_id'], not: { required: ['url'] } }],
        }) },
    { name: 'web_research', path: '/research', timeout: 130000,
      description: 'Research a topic with citations. Check quality, coverage and source evidence_kind; search_snippet does not mean the original page was read. No editor changes. Read artifact_id for full evidence.',
      schema: object({ topic: shortText(512), questions: Type.Optional(Type.Array(shortText(256), { maxItems: 5 })),
        max_sources: Type.Optional(Type.Integer({ minimum: 2, maximum: 5 })), focus: Type.Optional(shortText(256)) }) },
    { name: 'extract_web_images', path: '/extract-images', timeout: 25000,
      description: 'Discover public image candidates from either a URL or browser session. Does not import; use candidate_id with fetch_web_image.',
      schema: Type.Object({ url: Type.Optional(url), session_id: Type.Optional(uuid),
        max_images: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
        min_width: Type.Optional(Type.Integer({ minimum: 0, maximum: 4096 })) }, {
          additionalProperties: false, oneOf: [{ required: ['url'], not: { required: ['session_id'] } },
            { required: ['session_id'], not: { required: ['url'] } }],
        }) },
    { name: 'fetch_web_image', path: '/download', timeout: 35000, kind: 'image',
      description: 'Download and validate one image using candidate_id or URL (exactly one). Imports local material; then use add_to_track.', schema: download },
    { name: 'download_web_media', path: '/download', timeout: 185000, kind: 'media',
      description: 'Download one public direct audio/video file using candidate_id or URL. Imports local material; does not support playlists or login.', schema: download },
  ];
  return specs.map(spec => ({ name: spec.name, label: spec.name,
    description: spec.description, parameters: spec.schema,
    execute: async (id, params) => executeWebTool(context, id, {
      path: spec.path, timeout: spec.timeout, importMaterial: spec.kind ? 'record' : false,
      ...(spec.kind === 'image' ? { successFields: { next_step: STILL_IMAGE_NEXT_STEP } } : {}),
      body: { ...(params as Record<string, unknown>), ...(spec.kind ? { kind: spec.kind } : {}) },
    }) }));
}
