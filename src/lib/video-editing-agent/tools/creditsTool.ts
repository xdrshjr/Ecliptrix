import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import {
  collectLibraryWebMaterials, collectTimelineWebMaterials, isLicenseDeclared,
  type WebMaterialEntry,
} from './webMaterialProvenance';
import { executeToolkitTool, resolveProjectId, toolkitResult } from './toolkitAdapter';

/**
 * `build_credits`：把时间线上的网络素材整理成「来源与授权清单」（credits.md）。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.5。
 * 数据全部来自内存里的 `materials` 与 `timelineState`（零网络）；只有写入工作区
 * 才走一次 `/workspace/write`，且工作区关闭时降级为只返回前几行，不报错。
 */

export const CREDITS_FILE_NAME = 'credits.md';
/** 工具结果里最多回显的行数；完整清单在 credits.md 里。 */
const RESULT_ROW_LIMIT = 10;
/** 来源字段是不可信外部文本，每个单元格截到这个码点数。 */
const CELL_MAX_CHARS = 200;
const DISCLAIMER = '授权状态来自来源页面的公开声明，不构成法律意见。';

const parameters = Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal('used'), Type.Literal('all')],
    { description: "'used' (default): materials on the timeline; 'all': every web material in the library." })),
  write_to_workspace: Type.Optional(Type.Boolean(
    { description: 'Save credits.md to the workspace (default true).' })),
});

type Params = Static<typeof parameters>;

export interface CreditRow {
  name: string;
  source: string;
  author: string;
  license: string;
  retrieved_at: string;
  usage: string;
  unlicensed: boolean;
}

/** 转义单元格：折叠换行、转义 `|` 与反引号、截断码点，防止注入表格或指令。 */
export function escapeCell(value: unknown): string {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim();
  const clipped = Array.from(flat).slice(0, CELL_MAX_CHARS).join('');
  return clipped.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/`/g, '\\`');
}

function formatUsage(entry: WebMaterialEntry): string {
  if (entry.usages.length === 0) return '未上轨';
  return entry.usages.slice(0, 3)
    .map(use => `${use.trackId} ${use.start.toFixed(1)}-${use.end.toFixed(1)}s`)
    .join('; ') + (entry.usages.length > 3 ? ` +${entry.usages.length - 3}` : '');
}

export function toCreditRow(entry: WebMaterialEntry): CreditRow {
  const provenance = entry.provenance;
  const declared = isLicenseDeclared(provenance);
  const license = declared
    ? `已声明（${escapeCell(provenance?.license_url) || '见来源页'}）`
    : '**未声明，商用前请确认**';
  return {
    name: escapeCell(entry.name),
    source: escapeCell(provenance?.source_page_url ?? provenance?.final_url),
    author: escapeCell(provenance?.author),
    license,
    retrieved_at: escapeCell(provenance?.retrieved_at),
    usage: escapeCell(formatUsage(entry)),
    unlicensed: !declared,
  };
}

export function renderCreditsMarkdown(rows: readonly CreditRow[]): string {
  const header = '| 素材 | 来源页面 | 作者 | 授权 | 获取时间 | 使用位置 |\n'
    + '| --- | --- | --- | --- | --- | --- |';
  const body = rows.map(row => `| ${row.name} | ${row.source} | ${row.author} `
    + `| ${row.license} | ${row.retrieved_at} | ${row.usage} |`).join('\n');
  return `# 素材来源与授权清单\n\n${DISCLAIMER}\n\n${header}\n${body}\n`;
}

async function writeCredits(
  context: ToolContext, toolCallId: string, markdown: string,
): Promise<boolean> {
  const result = await executeToolkitTool(context, toolCallId, {
    path: '/workspace/write',
    body: {
      project_id: resolveProjectId(context),
      name: CREDITS_FILE_NAME,
      content: markdown,
      encoding: 'utf8',
      overwrite: true,
    },
  });
  return (result.details as { success?: boolean }).success === true;
}

export function createBuildCreditsTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'build_credits',
    label: 'Build credits',
    description:
      'List the web materials used on the timeline with their source page, author and '
      + 'declared licence, and save it as credits.md in the workspace. A licence of '
      + '"unknown" means the source page declared none; tell the user before export.',
    parameters,
    execute: async (toolCallId: string, params: Params) => {
      const collect = params.scope === 'all'
        ? collectLibraryWebMaterials : collectTimelineWebMaterials;
      const rows = collect(context.timelineState, context.materials).map(toCreditRow);
      if (rows.length === 0) {
        return toolkitResult({ success: true, total: 0, unlicensed: 0, written: null,
          rows: [], note: 'No web materials found; nothing to credit.' });
      }
      const wantsWrite = params.write_to_workspace !== false;
      const written = wantsWrite
        && await writeCredits(context, toolCallId, renderCreditsMarkdown(rows));
      return toolkitResult({
        success: true,
        total: rows.length,
        unlicensed: rows.filter(row => row.unlicensed).length,
        written: written ? { name: CREDITS_FILE_NAME } : null,
        rows: rows.slice(0, RESULT_ROW_LIMIT),
        ...(rows.length > RESULT_ROW_LIMIT ? { truncated: true } : {}),
        ...(wantsWrite && !written
          ? { note: '工作区未启用，已仅返回前 10 行 (workspace unavailable; first 10 rows only).' }
          : {}),
        next_step: 'Tell the user which materials have no declared licence.',
      });
    },
  };
}
