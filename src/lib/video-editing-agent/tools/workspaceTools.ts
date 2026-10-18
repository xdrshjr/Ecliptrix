import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import {
  executeToolkitTool,
  resolveProjectId,
  toolkitFailure,
  toolkitResult,
} from './toolkitAdapter';

/**
 * 工作区工具（5 个）。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.3 / §4.2。
 * `workspace_write` 只允许文本类产物（服务端扩展名白名单），媒体只能通过
 * `workspace_import_material` 从既有文件导入——不允许 Agent 手写伪造 mp4。
 */

const listParameters = Type.Object({
  prefix: Type.Optional(Type.String({
    description: 'Only list files under this relative folder, e.g. "script/".' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100,
    description: 'Max entries to return (default 50).' })),
});

const readParameters = Type.Object({
  name: Type.String({ description: 'Relative path inside the workspace, e.g. "script/outline.md".' }),
  offset: Type.Optional(Type.Integer({ minimum: 0,
    description: 'Byte offset to continue from (use next_offset from the previous call).' })),
  max_bytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 8000,
    description: 'Bytes per page (default 4000, max 8000).' })),
});

const writeParameters = Type.Object({
  name: Type.String({ description:
    'Relative path, at most 5 segments, e.g. "script/outline.md". ' +
    'Allowed extensions: .md .txt .csv .tsv .json .srt .vtt .svg .html .py .yaml .yml .xml' }),
  content: Type.String({ description: 'File body (UTF-8 text, or base64 when encoding="base64").' }),
  encoding: Type.Optional(Type.Union([Type.Literal('utf8'), Type.Literal('base64')],
    { description: 'Body encoding (default utf8).' })),
  overwrite: Type.Optional(Type.Boolean({
    description: 'Set true to replace an existing file. Default false (a replayed call then stays a no-op).' })),
});

const deleteParameters = Type.Object({
  name: Type.String({ description: 'Relative path of the file to delete.' }),
});

const importParameters = Type.Object({
  name: Type.String({ description:
    'Relative path of an existing workspace file with a media extension ' +
    '(.mp4 .mov .webm .mkv .mp3 .wav .m4a .aac .png .jpg .jpeg .webp .gif .svg).' }),
  material_name: Type.Optional(Type.String({
    description: 'Display name in the material library (default: file name).' })),
  material_type: Type.Optional(Type.Union([
    Type.Literal('image'), Type.Literal('video'), Type.Literal('audio')],
    { description: 'Override the detected material type.' })),
});

type ListParams = Static<typeof listParameters>;
type ReadParams = Static<typeof readParameters>;
type WriteParams = Static<typeof writeParameters>;
type DeleteParams = Static<typeof deleteParameters>;
type ImportParams = Static<typeof importParameters>;

interface ImportedMaterial {
  id: string; name: string; type: 'image' | 'video' | 'audio';
  format: string; size: number; width: number; height: number;
  duration: number; local_url: string;
  created_at?: string;
}

/** 与 `webToolAdapter.localMaterial` 同一条校验：只接受同源缓存路径。 */
function toMaterialItem(input: ImportedMaterial): MaterialItem | null {
  if (!/^\/api\/storage\/files\/cached_materials\/[a-z0-9_-]+\/[a-zA-Z0-9_.-]+$/
    .test(input.local_url)) return null;
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    format: input.format,
    size: input.size,
    width: input.width,
    height: input.height,
    duration: input.duration,
    createdAt: input.created_at ? new Date(input.created_at) : new Date(),
    url: input.local_url,
    serverUrl: input.local_url,
    cacheUrl: input.local_url,
    ...(input.type === 'image' ? { thumbnailUrl: input.local_url } : {}),
    cacheStatus: 'ready',
    metadata: { source: 'workspace', sourceId: input.id,
      storageKind: 'cached_remote' },
  };
}

export function createWorkspaceListTool(context: ToolContext): AgentTool<typeof listParameters> {
  return {
    name: 'workspace_list',
    label: 'List Workspace',
    description:
      'List files the agent wrote (files/) and documents the user uploaded (documents[]). ' +
      'Use it to discover a document_id or to check what already exists before writing.',
    parameters: listParameters,
    execute: async (toolCallId: string, params: ListParams) =>
      executeToolkitTool(context, toolCallId, {
        path: '/workspace/list',
        query: {
          project_id: resolveProjectId(context),
          prefix: params.prefix,
          limit: params.limit ?? 50,
        },
      }),
  };
}

export function createWorkspaceReadTool(context: ToolContext): AgentTool<typeof readParameters> {
  return {
    name: 'workspace_read',
    label: 'Read Workspace File',
    description:
      'Read one page of a workspace UTF-8 file; returns next_offset. ' +
      'Binary files are refused.',
    parameters: readParameters,
    execute: async (toolCallId: string, params: ReadParams) =>
      executeToolkitTool(context, toolCallId, {
        path: '/workspace/read',
        query: {
          project_id: resolveProjectId(context),
          name: params.name,
          offset: params.offset,
          max_bytes: params.max_bytes,
        },
      }),
  };
}

export function createWorkspaceWriteTool(context: ToolContext): AgentTool<typeof writeParameters> {
  return {
    name: 'workspace_write',
    label: 'Write Workspace File',
    description:
      'Save text (outline, draft, CSV, SVG, JSON) into the project workspace so it ' +
      'stays out of the conversation. Max 2 MiB; overwrite=true replaces.',
    parameters: writeParameters,
    execute: async (toolCallId: string, params: WriteParams) =>
      executeToolkitTool(context, toolCallId, {
        path: '/workspace/write',
        body: {
          project_id: resolveProjectId(context),
          name: params.name,
          content: params.content,
          encoding: params.encoding ?? 'utf8',
          overwrite: params.overwrite ?? false,
        },
      }),
  };
}

export function createWorkspaceDeleteTool(context: ToolContext): AgentTool<typeof deleteParameters> {
  return {
    name: 'workspace_delete',
    label: 'Delete Workspace File',
    description: 'Delete one file from the workspace. Does not touch the material library.',
    parameters: deleteParameters,
    execute: async (toolCallId: string, params: DeleteParams) =>
      executeToolkitTool(context, toolCallId, {
        path: '/workspace/file',
        method: 'DELETE',
        query: { project_id: resolveProjectId(context), name: params.name },
      }),
  };
}

export function createWorkspaceImportTool(context: ToolContext): AgentTool<typeof importParameters> {
  return {
    name: 'workspace_import_material',
    label: 'Import Workspace Media',
    description:
      'Import a workspace media file into the material library so add_to_track can ' +
      'use it. Analysis output is not imported automatically.',
    parameters: importParameters,
    execute: async (toolCallId: string, params: ImportParams) => {
      const result = await executeToolkitTool(context, toolCallId, {
        path: '/workspace/import',
        body: {
          project_id: resolveProjectId(context),
          name: params.name,
          material_name: params.material_name,
          material_type: params.material_type,
        },
      });
      const details = result.details as unknown as ImportedMaterial & {
        success: boolean; error_code?: string;
      };
      if (!details.success) return result;
      const material = toMaterialItem(details);
      if (!material) {
        return toolkitFailure('invalid_argument', {
          message: 'the imported material has no same-origin local_url',
        }, 'Report the problem; do not call add_to_track with this material.');
      }
      const exists = context.materials.some(item => item.id === material.id);
      if (!exists && !context.abortSignal?.aborted) {
        context.recordOperation(toolCallId, {
          type: 'add_materials', materials: [material] });
        context.materials.push(material);
      }
      // 再过一次 `toolkitResult`：`content` 与 `details` 必须是**同一份**有界
      // 载荷（`webToolAdapter` 的约定），否则模型看到的和界面存下的会不一致。
      return toolkitResult({ ...details, already_in_library: exists });
    },
  };
}

export function createWorkspaceTools(context: ToolContext) {
  return [
    createWorkspaceListTool(context),
    createWorkspaceReadTool(context),
    createWorkspaceWriteTool(context),
    createWorkspaceDeleteTool(context),
    createWorkspaceImportTool(context),
  ];
}
