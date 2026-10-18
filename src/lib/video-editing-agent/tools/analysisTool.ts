import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { executeToolkitTool, resolveProjectId } from './toolkitAdapter';

/**
 * `run_analysis`：离线 Python 计算（默认关闭）。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §3.4。
 * 沙箱用 AST 白名单 + 独立进程限制，**不是**内核级隔离：只有墙钟超时，
 * 没有内存上限。产物落在 `out/<call_id>/`，要进素材库须再调
 * `workspace_import_material`。
 */

const parameters = Type.Object({
  code: Type.String({ description:
    'Python source, max 6000 chars. Only math/statistics/json/csv/re/datetime/decimal/' +
    'fractions/itertools/collections/functools/string/textwrap/random/unicodedata/' +
    'base64/hashlib; no open/eval/exec, no private attrs. Use write_text/write_json/' +
    'write_csv/write_svg and read_text; print() goes to stdout.' }),
  purpose: Type.Optional(Type.String({
    description: 'One-line reason, shown in the UI card.' })),
});

type Params = Static<typeof parameters>;

export function createAnalysisTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'run_analysis',
    label: 'Run Analysis',
    description:
      'Run offline Python for arithmetic, tables and generated files (CSV/SVG). ' +
      'Requires the user to enable Analysis in Settings → Agent capabilities. ' +
      'A non-zero exit code is a normal tool result, not a failure.',
    parameters,
    execute: async (toolCallId: string, params: Params) =>
      executeToolkitTool(context, toolCallId, {
        path: '/analysis/run',
        body: {
          project_id: resolveProjectId(context),
          code: params.code,
          purpose: params.purpose,
        },
      }),
  };
}

export function createAnalysisTools(context: ToolContext) {
  return [createAnalysisTool(context)];
}
