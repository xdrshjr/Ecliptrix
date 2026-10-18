import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { executeToolkitTool, resolveProjectId } from './toolkitAdapter';

/**
 * 长期记忆三件套：写入 / 检索 / 遗忘。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.6。
 * 记忆落 SQLite（`agent_memories`），用户可在设置面板逐条删除；注入进 prompt
 * 的摘要恒 ≤800 字符，检索结果恒 ≤1600 字节。
 */

const writeParameters = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 1000,
    description: 'One durable fact, preference or decision. No credentials.' }),
  kind: Type.Optional(Type.Union([
    Type.Literal('fact'), Type.Literal('preference'), Type.Literal('decision')],
    { description: 'Default fact.' })),
  tags: Type.Optional(Type.Array(Type.String({ maxLength: 24 }),
    { maxItems: 6, description: 'Up to 6 short tags.' })),
  scope: Type.Optional(Type.Union([
    Type.Literal('project'), Type.Literal('global')],
    { description: 'project (default) or global across projects.' })),
  expires_in_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 365,
    description: 'Override the default retention.' })),
});

const searchParameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200,
    description: 'Keyword search over memory text and tags.' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5,
    description: 'Max entries (default 5).' })),
  scope: Type.Optional(Type.Union([
    Type.Literal('project'), Type.Literal('global'), Type.Literal('all')],
    { description: 'Default all (project + global).' })),
});

const forgetParameters = Type.Object({
  memory_id: Type.String({ description: 'id from memory_search or /memory/digest.' }),
});

type WriteParams = Static<typeof writeParameters>;
type SearchParams = Static<typeof searchParameters>;
type ForgetParams = Static<typeof forgetParameters>;

export function createMemoryWriteTool(
  context: ToolContext,
): AgentTool<typeof writeParameters> {
  return {
    name: 'memory_write',
    label: 'Remember',
    description:
      'Store one durable note for this project (or globally): a confirmed preference, a ' +
      'decision, or a stable fact. Deduplicated — writing the same text twice updates it.',
    parameters: writeParameters,
    execute: async (toolCallId: string, params: WriteParams) =>
      executeToolkitTool(context, toolCallId, {
        path: '/memory',
        body: {
          project_id: resolveProjectId(context),
          text: params.text,
          kind: params.kind ?? 'fact',
          tags: params.tags ?? [],
          scope: params.scope ?? 'project',
          expires_in_days: params.expires_in_days,
        },
      }),
  };
}

export function createMemorySearchTool(
  context: ToolContext,
): AgentTool<typeof searchParameters> {
  return {
    name: 'memory_search',
    label: 'Search Memory',
    description:
      'Search previously stored notes for this project and the global bucket. ' +
      'Call it before asking the user something they may already have told you.',
    parameters: searchParameters,
    execute: async (toolCallId: string, params: SearchParams) =>
      executeToolkitTool(context, toolCallId, {
        path: '/memory/search',
        query: {
          project_id: resolveProjectId(context),
          q: params.query,
          limit: params.limit ?? 5,
          scope: params.scope ?? 'all',
        },
      }),
  };
}

export function createMemoryForgetTool(
  context: ToolContext,
): AgentTool<typeof forgetParameters> {
  return {
    name: 'memory_forget',
    label: 'Forget',
    description:
      'Delete one stored note. Use it when the user says a remembered preference no longer ' +
      'applies, or when the bucket is full and an old entry is stale.',
    parameters: forgetParameters,
    execute: async (toolCallId: string, params: ForgetParams) =>
      executeToolkitTool(context, toolCallId, {
        path: `/memory/${encodeURIComponent(params.memory_id)}`,
        method: 'DELETE',
        query: { project_id: resolveProjectId(context) },
      }),
  };
}

export function createMemoryTools(context: ToolContext) {
  return [
    createMemoryWriteTool(context),
    createMemorySearchTool(context),
    createMemoryForgetTool(context),
  ];
}
