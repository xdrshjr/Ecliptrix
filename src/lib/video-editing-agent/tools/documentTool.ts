import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { executeToolkitTool, resolveProjectId } from './toolkitAdapter';

/**
 * `read_document`：按页精读上传的 PDF/DOCX/文本/CSV/字幕。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.3.4。
 * 关键纪律：**永不**整篇返回；单页超长时用 `next_offset` 续读。
 */

/**
 * 单次读取的字符上限。
 *
 * spec §4.2 写的是 1..8000，但工具结果整条受 `RESULT_BYTE_CAP`（12 KiB）
 * 约束：中文一字符 3 字节、emoji 4 字节，8000 字符 = 24–32 KiB，会被结果
 * 裁剪切断正文却仍报告后端算出来的 `next_offset`，模型会以为自己读完了。
 * 取 2000 字符（最坏 8 KiB）让「一次读一页」真正成立。
 */
const MAX_CHARS_PER_CALL = 2000;

const parameters = Type.Object({
  document_id: Type.Optional(Type.String({
    description: 'Document id from workspace_list documents[] or a [[doc:<id>]] message.' })),
  name: Type.Optional(Type.String({
    description: 'Original file name, used only when document_id is unknown.' })),
  page: Type.Optional(Type.Integer({ minimum: 1,
    description: 'Page number starting at 1 (default 1).' })),
  offset: Type.Optional(Type.Integer({ minimum: 0,
    description: 'Character offset inside the page — pass next_offset to continue a long page.' })),
  max_chars: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_CHARS_PER_CALL,
    description: `Characters per call (default 1500, max ${MAX_CHARS_PER_CALL}).` })),
});

type Params = Static<typeof parameters>;

export function createReadDocumentTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'read_document',
    label: 'Read Document',
    description:
      'Read one page of an uploaded document; returns content, next_page, next_offset. ' +
      'The digest is a summary, never evidence.',
    parameters,
    execute: async (toolCallId: string, params: Params) =>
      executeToolkitTool(context, toolCallId, {
        path: '/documents/read',
        query: {
          project_id: resolveProjectId(context),
          document_id: params.document_id,
          name: params.name,
          page: params.page ?? 1,
          offset: params.offset,
          max_chars: params.max_chars ?? 1500,
        },
        nextStep: params.document_id || params.name
          ? undefined
          : 'Call workspace_list first to get a document_id.',
      }),
  };
}

export function createDocumentTools(context: ToolContext) {
  return [createReadDocumentTool(context)];
}
