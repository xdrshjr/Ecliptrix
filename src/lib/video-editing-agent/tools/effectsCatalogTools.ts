import { z } from 'zod';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@mariozechner/pi-ai';
import { EffectError } from '@/types/effects';
import { validateEffectDocument } from '@/lib/effects/validation';
import type { EffectDraftRecovery, EffectRenderRecovery,
  ToolContext } from '../types';
import { toolFetch } from './apiHelper';

export const effectId = z.string().min(1).max(128);
export const effectUuid = z.uuid();
export const strictObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();
export const effectText = (maximum: number) => z.string()
  .refine(value => Array.from(value).length <= maximum)
  .meta({ maxLength: maximum });

const finite = z.number().finite();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
// Keep the complete recovery document visible to JSON Schema conversion;
// template-specific parameter/slot validation still runs before HTTP.
const recoveryDocument = strictObject({
  schemaVersion: z.literal(1), templateId: effectId,
  templateVersion: z.number().int().positive(),
  canvas: strictObject({ width: z.number().int().min(64).max(1920),
    height: z.number().int().min(64).max(1920), fps: z.literal(30) }),
  durationFrames: z.number().int().min(15).max(1800),
  seed: z.number().int().min(0).max(2147483647),
  content: strictObject({ title: effectText(120), subtitle: effectText(300) }),
  palette: strictObject({ background: color, foreground: color, accent: color }),
  typography: strictObject({ family: z.enum(['sans', 'serif', 'mono']),
    scale: finite.min(0.6).max(1.4),
    align: z.enum(['left', 'center', 'right']) }),
  motion: strictObject({ speed: finite.min(0.5).max(2),
    intensity: finite.min(0).max(1) }),
  params: z.record(z.string(), z.union([z.string(), finite, z.array(finite)])),
  inputs: z.array(strictObject({ slot: effectId, assetId: effectUuid,
    kind: z.enum(['image', 'video']), fit: z.enum(['cover', 'contain']),
    focalX: finite.min(0).max(1), focalY: finite.min(0).max(1),
    index: z.number().int().min(0).max(7).optional(),
    trimStartSeconds: finite.min(0).optional() })).max(9),
});
const writeContent = { draftId: effectUuid, name: effectText(100),
  document: recoveryDocument };
export const effectCreateWrite = strictObject({ kind: z.literal('create'),
  ...writeContent });
export const effectUpdateWrite = strictObject({ kind: z.literal('update'),
  ...writeContent, expectedVersion: z.number().int().positive() });
const recoveryHeader = { schemaVersion: z.literal(1), projectId: effectId };
export const effectCreateRecovery = strictObject({ ...recoveryHeader,
  write: effectCreateWrite });
export const effectUpdateRecovery = strictObject({ ...recoveryHeader,
  write: effectUpdateWrite });
export const effectDraftRecovery = z.union([
  effectCreateRecovery, effectUpdateRecovery,
]);
export const effectRenderRecovery = strictObject({ ...recoveryHeader,
  requestId: effectUuid, draftId: effectId,
  expectedVersion: z.number().int().positive(),
  profile: z.enum(['mp4-1080p', 'mp4-720p']),
});

/** Compare frozen public values independently of object key insertion order. */
export function effectIdentity(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(effectIdentity).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${effectIdentity(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function parseEffectDraftRecovery(value: unknown): EffectDraftRecovery {
  const parsed = effectDraftRecovery.parse(value);
  parsed.write.document = validateEffectDocument(parsed.write.document);
  return parsed;
}

/** Only validated, public recovery fields survive the common error wrapper. */
export class EffectRecoveryError extends EffectError {
  readonly result: Record<string, unknown>;

  constructor(toolCallId: string,
    recovery: EffectDraftRecovery | EffectRenderRecovery,
    code = 'EFFECT_SUBMISSION_UNKNOWN') {
    super(code);
    effectId.parse(toolCallId);
    const frozen = 'write' in recovery
      ? parseEffectDraftRecovery(recovery) : effectRenderRecovery.parse(recovery);
    this.result = { success: false, status: 'unknown', error_code: code,
      schemaVersion: 1, projectId: frozen.projectId, toolCallId,
      draftId: 'write' in frozen ? frozen.write.draftId : frozen.draftId,
      recovery: frozen,
      ...('write' in frozen ? {} : { requestId: frozen.requestId,
        expectedVersion: frozen.expectedVersion, profile: frozen.profile }) };
  }
}

/** An incomplete history cannot authorize a newly reconstructed write. */
export class EffectRecoveryUnavailableError extends EffectError {
  readonly result: Record<string, unknown>;

  constructor(context: ToolContext, toolCallId: string, draftId: string,
    kind: 'draft' | 'render') {
    super('EFFECT_SUBMISSION_UNKNOWN');
    this.result = { success: false, status: 'unknown', schemaVersion: 1,
      error_code: this.code, projectId: effectId.parse(context.projectId),
      toolCallId: effectId.parse(toolCallId), draftId: effectId.parse(draftId),
      recoveryUnavailable: true, recoveryKind: kind,
      nextAction: 'open_effects_studio_history' };
  }
}

export function assertEffectDraftSettled(context: ToolContext,
  draftId: string, toolCallId: string): void {
  const pending = context.effectsPendingDrafts?.get(draftId);
  if (pending) throw new EffectRecoveryError(toolCallId, pending.recovery);
  if (context.effectsRecoveryIncomplete?.has(draftId)) {
    throw new EffectRecoveryUnavailableError(context, toolCallId, draftId, 'draft');
  }
}

function readRecoveryResult(context: ToolContext, result: unknown,
  toolCallId: string): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return;
  const value = result as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.projectId !== context.projectId
    || value.toolCallId !== toolCallId || !effectId.safeParse(toolCallId).success) return;
  return value;
}

function canCarryDraftRecovery(toolName: string,
  result: Record<string, unknown>): boolean {
  if (['create_effect_draft', 'update_effect_draft'].includes(toolName)) return true;
  // A refused render returns the draft guard's original recovery, before any
  // render submission exists. Render request fields identify a different write.
  return toolName === 'render_effect' && result.success === false
    && result.status === 'unknown' && result.requestId === undefined
    && result.expectedVersion === undefined && result.profile === undefined;
}

/** Called on original structured history before model-facing compaction. */
export function restoreEffectsRecovery(context: ToolContext, call: {
  id: string; name: string; result?: unknown;
}): void {
  if (!['create_effect_draft', 'update_effect_draft', 'render_effect',
    'get_effect_job'].includes(call.name)) return;
  const result = readRecoveryResult(context, call.result, call.id);
  if (!result) return;
  if (result.success === false && result.status === 'unknown'
    && result.recoveryUnavailable === true
    && effectId.safeParse(result.draftId).success) {
    if (result.recoveryKind === 'draft' && canCarryDraftRecovery(call.name, result)) {
      (context.effectsRecoveryIncomplete ??= new Set()).add(result.draftId as string);
    } else if (result.recoveryKind === 'render'
      && ['render_effect', 'get_effect_job'].includes(call.name)) {
      (context.effectsRenderRecoveryIncomplete ??= new Set()).add(result.draftId as string);
    }
    return;
  }
  const recovery = result.recovery;
  const hasDraftWrite = recovery && typeof recovery === 'object'
    && !Array.isArray(recovery) && 'write' in recovery;
  if (canCarryDraftRecovery(call.name, result) && (hasDraftWrite
    || ['create_effect_draft', 'update_effect_draft'].includes(call.name))) {
    restoreDraftRecovery(context, call.name, call.id, result);
  } else if (['render_effect', 'get_effect_job'].includes(call.name)) {
    restoreRenderRecovery(context, call.id, result);
  }
}

function restoreDraftRecovery(context: ToolContext, toolName: string,
  toolCallId: string, result: Record<string, unknown>): void {
  let recovery: EffectDraftRecovery;
  try { recovery = parseEffectDraftRecovery(result.recovery); }
  catch {
    if (result.success === false && result.status === 'unknown'
      && effectUuid.safeParse(result.draftId).success) {
      (context.effectsRecoveryIncomplete ??= new Set()).add(result.draftId as string);
    }
    return;
  }
  const { write } = recovery;
  if (recovery.projectId !== context.projectId || write.draftId !== result.draftId
    || (result.success === true
      && (toolName === 'create_effect_draft') !== (write.kind === 'create'))) return;
  const pending = context.effectsPendingDrafts ??= new Map();
  if (result.success === false && result.status === 'unknown') {
    pending.set(write.draftId, { toolCallId, recovery });
  } else if (result.success === true && result.committedVersion
    === (write.kind === 'create' ? 1 : write.expectedVersion + 1)) {
    if (effectIdentity(pending.get(write.draftId)?.recovery)
      === effectIdentity(recovery)) pending.delete(write.draftId);
    context.effectsRecoveryIncomplete?.delete(write.draftId);
  }
}

function restoreRenderRecovery(context: ToolContext, toolCallId: string,
  result: Record<string, unknown>): void {
  const pending = context.effectsPendingRenders ??= new Map();
  if (result.success === false && result.status === 'unknown') {
    const parsed = effectRenderRecovery.safeParse(result.recovery);
    if (parsed.success && parsed.data.projectId === context.projectId
      && parsed.data.requestId === result.requestId
      && parsed.data.draftId === result.draftId
      && parsed.data.expectedVersion === result.expectedVersion
      && parsed.data.profile === result.profile) {
      pending.set(parsed.data.requestId, { toolCallId, recovery: parsed.data });
    } else if (effectId.safeParse(result.draftId).success) {
      (context.effectsRenderRecoveryIncomplete ??= new Set()).add(result.draftId as string);
    }
  } else if (result.success === true && typeof result.requestId === 'string') {
    const previous = pending.get(result.requestId);
    const statuses = ['queued', 'running', 'cancelling', 'succeeded',
      'failed', 'cancelled', 'interrupted'];
    if (previous && previous.recovery.draftId === result.draftId
      && previous.recovery.expectedVersion === result.draftVersion
      && statuses.includes(String(result.status))) pending.delete(result.requestId);
  }
}

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
        details = error instanceof EffectRecoveryError
          || error instanceof EffectRecoveryUnavailableError ? error.result
          : { success: false, error_code: error instanceof EffectError
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
