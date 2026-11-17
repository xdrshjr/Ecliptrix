import { z } from 'zod';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@mariozechner/pi-ai';
import { EffectError } from '@/types/effects';
import type { ToolContext } from '../types';
import { toolFetch } from './apiHelper';

export const effectId = z.string().min(1).max(128);
export const effectUuid = z.uuid();
export const strictObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();
export const effectText = (maximum: number) => z.string()
  .refine(value => Array.from(value).length <= maximum)
  .meta({ maxLength: maximum });

export class EffectRequestError extends EffectError {
  constructor(code: string, readonly status: number) { super(code); }
}

/** All Agent writes explicitly disable transport retries. */
export async function effectRequest(context: ToolContext, path: string,
  options: { method?: string; body?: unknown; cleanup?: boolean } = {}) {
  const owner = options.cleanup ? { ...context, abortSignal: undefined } : context;
  const response = await toolFetch(owner, `/api/effects${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    timeout: options.cleanup ? 5000 : 30000, retry: false,
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new EffectRequestError(payload.error_code ?? 'EFFECT_BACKEND_ERROR',
      response.status);
  }
  return payload.data as Record<string, unknown>;
}

export function effectProjectPath(context: ToolContext, suffix: string): string {
  if (!context.projectId) throw new EffectError('EFFECT_NOT_FOUND');
  return `/projects/${encodeURIComponent(context.projectId)}${suffix}`;
}

/** Zod checks actual execute inputs; JSON Schema is only model disclosure. */
export function makeEffectTool<S extends z.ZodType>(options: {
  context: ToolContext; name: string; description: string; schema: S;
  run: (id: string, params: z.output<S>) => Promise<Record<string, unknown>>;
}): AgentTool<TSchema> {
  const converted = z.toJSONSchema(options.schema, { target: 'draft-7' });
  const parameters = converted as unknown as TSchema;
  return { name: options.name, label: options.name,
    description: options.description,
    parameters,
    execute: async (id, raw) => {
      let details: Record<string, unknown>;
      try {
        options.context.abortSignal?.throwIfAborted();
        details = await options.run(id, options.schema.parse(raw));
      } catch (error) {
        details = { success: false, error_code: error instanceof EffectError
          ? error.code : error instanceof z.ZodError
            ? 'EFFECT_INVALID_ARGUMENT' : 'EFFECT_REQUEST_FAILED' };
      }
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    } };
}

export function createEffectsCatalogTools(context: ToolContext) {
  return [makeEffectTool({ context, name: 'list_effect_templates',
    description: 'List up to 12 built-in effect summaries; get one template for its editable schema.',
    schema: strictObject({ libraryId: effectId.optional(),
      query: effectText(80).optional(), cursor: effectId.optional(),
      limit: z.number().int().min(1).max(12).optional() }),
    run: async (_, params) => {
      const query = new URLSearchParams({ page_size: String(params.limit ?? 12) });
      if (params.libraryId) query.set('library_id', params.libraryId);
      if (params.query) query.set('query', params.query);
      if (params.cursor) query.set('cursor', params.cursor);
      const page = await effectRequest(context, `/templates?${query}`);
      const items = z.array(z.object({ id: effectId, version: z.number().int().optional(),
        library_id: effectId.optional(), name_key: effectId.optional(),
        description_key: effectId.optional(), thumbnail: z.string().optional(),
        allowed_input_kinds: z.array(z.enum(['image', 'video'])).optional(),
      }).strip()).max(params.limit ?? 12).parse(page.items);
      const result = { success: true, items, next_cursor: page.next_cursor };
      if (new TextEncoder().encode(JSON.stringify(result)).length > 12 * 1024) {
        throw new EffectError('EFFECT_RESULT_TOO_LARGE');
      }
      return result;
    } }),
  makeEffectTool({ context, name: 'get_effect_template',
    description: 'Read one effect template, its version, slots, parameter schema and defaults.',
    schema: strictObject({ templateId: effectId }),
    run: async (_, params) => {
      const template = await effectRequest(context,
        `/templates/${encodeURIComponent(params.templateId)}`);
      if (new TextEncoder().encode(JSON.stringify(template)).length > 24 * 1024) {
        throw new EffectError('EFFECT_RESULT_TOO_LARGE');
      }
      return { success: true, template };
    } })];
}
