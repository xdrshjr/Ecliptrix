import { Type, type Static, type TSchema } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { CoverDocument, CoverRevision } from '@/types/videoCover';
import { applyCoverTemplate, createCoverDocument } from '@/components/video/cover/templates';
import type { CoverOperation, ToolContext } from '../types';
import { toolFetch } from './apiHelper';

const strict = { additionalProperties: false };
const templates = ['editorial', 'cinematic', 'knowledge', 'product', 'bold'] as const;
const fields = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 80 })),
  subtitle: Type.Optional(Type.String({ maxLength: 160 })),
  label: Type.Optional(Type.String({ maxLength: 24 })),
}, strict);
const duration = Type.Optional(Type.Number({ minimum: 0.1, maximum: 5 }));
const prompt = Type.Optional(Type.String({ maxLength: 2000 }));
const color = Type.String({ pattern: '^#[0-9a-fA-F]{6}$' });
const typography = Type.Object({
  family: Type.Optional(Type.Union([
    Type.Literal('sans'), Type.Literal('serif'), Type.Literal('mono'),
  ])),
  titleScale: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1.5 })),
  align: Type.Optional(Type.Union([
    Type.Literal('left'), Type.Literal('center'), Type.Literal('right'),
  ])),
  textColor: Type.Optional(color), accentColor: Type.Optional(color),
}, strict);
const getParameters = Type.Object({}, strict);
const createParameters = Type.Object({
  mode: Type.Union([Type.Literal('html'), Type.Literal('ai'), Type.Literal('mixed')]),
  templateId: Type.Union(templates.map(id => Type.Literal(id))),
  fields: Type.Optional(fields), prompt,
  count: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(4)])),
  durationSeconds: duration, applyWhenReady: Type.Optional(Type.Boolean()),
}, strict);
const updateParameters = Type.Object({
  expectedVersion: Type.Integer({ minimum: 1 }),
  fields: Type.Optional(fields), typography: Type.Optional(typography),
  backgroundAssetId: Type.Optional(Type.String({ minLength: 1 })),
  prompt, durationSeconds: duration,
}, strict);
const applyParameters = Type.Object({
  revisionId: Type.Optional(Type.String({ minLength: 1 })),
  expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  durationSeconds: duration,
}, strict);

interface Draft {
  document: CoverDocument | null;
  version: number;
  documentHash?: string;
}

class CoverToolError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Server tools never import the browser HTTP client. */
function convertKeys(value: unknown, wire: boolean): unknown {
  if (Array.isArray(value)) return value.map(item => convertKeys(item, wire));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    wire ? key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`)
      : key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
    convertKeys(item, wire),
  ]));
}

async function request<T>(
  context: ToolContext, suffix = '', body?: unknown,
  options: { method?: string; cleanup?: boolean } = {},
): Promise<T> {
  const ctx = options.cleanup ? { ...context, abortSignal: undefined } : context;
  const path = `/api/video-cover-v2/${encodeURIComponent(context.projectId!)}`;
  const response = await toolFetch(ctx, path + suffix, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    ...(body === undefined ? {} : { body: JSON.stringify(convertKeys(body, true)) }),
    timeout: options.cleanup ? 5000 : 30_000, retry: false,
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new CoverToolError(payload.error_code ?? 'COVER_REQUEST_FAILED',
      payload.message ?? `封面请求失败 (${response.status})`);
  }
  return convertKeys(payload.data, false) as T;
}

function assertReady(document: CoverDocument | null): asserts document is CoverDocument {
  if (!document || (document.mode !== 'html' && !document.background.assetId)
    || (document.mode !== 'ai'
      && !document.fields.title.trim() && !document.fields.subtitle.trim())) {
    throw new CoverToolError('COVER_DRAFT_NOT_READY', '草稿尚未就绪，请先准备文字或背景图片。');
  }
}

function withDuration(document: CoverDocument, seconds?: number): CoverDocument {
  return { ...document, durationFrames: seconds === undefined
    ? document.durationFrames : Math.round(seconds * 30) };
}

/** Also validate direct execution: Unicode limits count code points. */
function validate(schema: TSchema, value: unknown): void {
  if (schema.anyOf) {
    const valid = (schema.anyOf as TSchema[]).some(option => {
      try { validate(option, value); return true; } catch { return false; }
    });
    if (valid) return;
    throw new CoverToolError('COVER_INVALID_ARGUMENT', '参数不在允许范围。');
  }
  if ('const' in schema && value !== schema.const) throw new Error('参数值无效');
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数必须为对象');
    const record = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, TSchema>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) throw new Error(`缺少参数 ${key}`);
    }
    for (const [key, item] of Object.entries(record)) {
      if (!properties[key]) throw new Error(`未知参数 ${key}`);
      validate(properties[key], item);
    }
  }
  if (schema.type === 'string' && (typeof value !== 'string'
    || Array.from(value).length > (schema.maxLength ?? Infinity)
    || Array.from(value).length < (schema.minLength ?? 0)
    || (schema.pattern && !new RegExp(schema.pattern).test(value)))) throw new Error('文字参数无效或过长');
  if (['number', 'integer'].includes(schema.type) && (typeof value !== 'number'
    || !Number.isFinite(value) || value < (schema.minimum ?? -Infinity)
    || value > (schema.maximum ?? Infinity)
    || (schema.type === 'integer' && !Number.isInteger(value)))) throw new Error('数值参数越界');
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error('参数必须为布尔值');
}

function makeTool<S extends TSchema>(options: {
  context: ToolContext; name: string; description: string; parameters: S;
  run: (id: string, params: Static<S>) => Promise<Record<string, unknown>>;
}): AgentTool<S> {
  return {
    name: options.name, label: options.name,
    description: options.description, parameters: options.parameters,
    execute: async (id, params) => {
      let details: Record<string, unknown>;
      try {
        if (!options.context.projectId) {
          throw new CoverToolError('COVER_PROJECT_CHANGED', '请先打开一个视频工程。');
        }
        validate(options.parameters, params);
        details = await options.run(id, params);
      } catch (error) {
        details = { success: false,
          error_code: error instanceof CoverToolError ? error.code : 'COVER_INVALID_ARGUMENT',
          error: error instanceof Error ? error.message : String(error) };
      }
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  };
}

export function createGetVideoCoverTool(context: ToolContext) {
  return makeTool({ context, name: 'get_video_cover', parameters: getParameters,
    description: '读取封面草稿、任务、模板以及本轮请求的时间轴快照；不是实时编辑器状态。',
    run: async () => ({
      success: true, ...await request<Draft>(context), templates,
      timelineSnapshot: {
        source: 'request_snapshot',
        covers: context.timelineState.tracks.flatMap(track => track.items
          .filter(item => item.metadata?.role === 'video-cover')
          .map(item => ({ trackId: track.id, clip: item }))),
      },
    }),
  });
}

async function cancelRequest(context: ToolContext, id: string): Promise<boolean> {
  try {
    await request(context, '/jobs/cancel-by-request',
      { requestId: `agent:${id}` }, { cleanup: true });
    return true;
  } catch (error) {
    console.warn('[coverTools] 取消尚未确认', { toolCallId: id, error });
    return false;
  }
}

async function createCover(context: ToolContext, id: string,
  params: Static<typeof createParameters>): Promise<Record<string, unknown>> {
  const billed = params.mode !== 'html';
  try {
    context.abortSignal?.throwIfAborted();
    if (billed && !params.prompt?.trim()) {
      throw new CoverToolError('COVER_DRAFT_NOT_READY', 'AI 制作需要非空提示词。');
    }
    const current = await request<Draft>(context);
    const base = current.document ?? createCoverDocument({
      aspectRatio: ((context.timelineState as typeof context.timelineState & {
        aspectRatioId?: CoverDocument['aspectRatio'];
      }).aspectRatioId ?? '16:9'),
      templateId: params.templateId, mode: params.mode,
    });
    const selected = base.templateId === params.templateId
      ? base : applyCoverTemplate(base, params.templateId);
    const document = withDuration({ ...selected, mode: params.mode,
      fields: { ...base.fields, ...params.fields },
      generation: { prompt: params.prompt ?? base.generation.prompt,
        count: params.count ?? base.generation.count },
    }, params.durationSeconds);
    if (!billed) assertReady(document);
    const saved = await request<Draft>(context, '', {
      expectedVersion: current.version, document,
    }, { method: 'PUT' });
    const common = { type: 'cover_action' as const,
      projectId: context.projectId!, operationId: id,
      durationFrames: document.durationFrames,
      applyWhenReady: params.applyWhenReady ?? true };
    if (!billed) {
      context.abortSignal?.throwIfAborted();
      context.recordOperation(id, { ...common, action: 'prepare_draft',
        draftVersion: saved.version });
      return { success: true, status: 'draft_ready', version: saved.version,
        message: '草稿已准备，等待客户端渲染。' };
    }
    const job = await request<{ jobId: string; status: string }>(context, '/jobs', {
      requestId: `agent:${id}`, baseVersion: saved.version,
      mode: params.mode, templateId: params.templateId,
      prompt: document.generation.prompt, count: document.generation.count,
      aspectRatio: document.aspectRatio, referenceAssetIds: [],
    });
    context.abortSignal?.throwIfAborted();
    if (job.status === 'queued' || job.status === 'running') {
      // The tool can finish before the Agent connection does. Keep its
      // cleanup attached to that connection, using a fresh bounded signal.
      context.abortSignal?.addEventListener('abort', () => {
        void cancelRequest(context, id);
      }, { once: true });
    }
    if (job.status !== 'cancelled') context.recordOperation(id, {
      ...common, action: 'watch_job', jobId: job.jobId,
      draftVersion: saved.version,
    });
    return { success: true, status: job.status, jobId: job.jobId,
      version: saved.version, message: job.status === 'cancelled'
        ? '本次制作已取消。' : '已开始制作，完成后会显示结果。' };
  } catch (error) {
    if (billed && context.abortSignal?.aborted) {
      const confirmed = await cancelRequest(context, id);
      return { success: false, status: 'cancelled',
        cancellationConfirmed: confirmed,
        error: confirmed ? '本次制作已取消。' : '取消尚未确认。' };
    }
    throw error;
  }
}

export function createCreateVideoCoverTool(context: ToolContext) {
  return makeTool({ context, name: 'create_video_cover', parameters: createParameters,
    description: '制作 HTML、AI 或混合封面。默认自动应用；用户只要方案/候选时 applyWhenReady=false。queued 不代表已完成。',
    run: (id, params) => createCover(context, id, params),
  });
}

export function createUpdateVideoCoverTool(context: ToolContext) {
  return makeTool({ context, name: 'update_video_cover', parameters: updateParameters,
    description: '按版本编辑封面草稿，不隐式重新生图或应用。',
    run: async (_id, params) => {
      const current = await request<Draft>(context);
      if (!current.document || current.version !== params.expectedVersion) {
        throw new CoverToolError('COVER_VERSION_CONFLICT', '草稿已变更，请读取最新版本。');
      }
      const base = current.document;
      const document = withDuration({ ...base,
        fields: { ...base.fields, ...params.fields },
        typography: { ...base.typography, ...params.typography },
        background: params.backgroundAssetId ? { ...base.background,
          kind: 'asset', assetId: params.backgroundAssetId } : base.background,
        generation: { ...base.generation,
          prompt: params.prompt ?? base.generation.prompt },
      }, params.durationSeconds);
      return { success: true, status: 'draft_ready',
        ...await request<Draft>(context, '', {
          expectedVersion: params.expectedVersion, document,
        }, { method: 'PUT' }) };
    },
  });
}

export function createApplyVideoCoverTool(context: ToolContext) {
  return makeTool({ context, name: 'apply_video_cover', parameters: applyParameters,
    description: '应用已有封面版本，或渲染指定草稿版本；不发起生图。',
    run: async (id, params) => {
      if (params.revisionId && params.expectedVersion !== undefined) {
        throw new Error('revisionId 与 expectedVersion 只能指定一个。');
      }
      let operation: CoverOperation;
      const common = { type: 'cover_action' as const,
        projectId: context.projectId!, operationId: id, applyWhenReady: true };
      if (params.revisionId) {
        const revision = await request<CoverRevision>(context,
          `/revisions/${encodeURIComponent(params.revisionId)}`);
        operation = { ...common, action: 'apply_revision', revisionId: revision.id,
          durationFrames: withDuration(revision.document, params.durationSeconds).durationFrames };
      } else {
        const draft = await request<Draft>(context);
        if (params.expectedVersion === undefined || draft.version !== params.expectedVersion) {
          throw new CoverToolError('COVER_VERSION_CONFLICT', '请先读取草稿并指定其 expectedVersion。');
        }
        assertReady(draft.document);
        operation = { ...common, action: 'prepare_draft', draftVersion: draft.version,
          durationFrames: withDuration(draft.document, params.durationSeconds).durationFrames };
      }
      context.abortSignal?.throwIfAborted();
      context.recordOperation(id, operation);
      return { success: true, status: 'draft_ready',
        message: '已请求客户端准备并应用，尚未确认写入视频。' };
    },
  });
}
