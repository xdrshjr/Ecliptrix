import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { toolkitResult } from './toolkitAdapter';
import { defaultTargetResolution, lintTimeline } from './qualityLint';

/**
 * `check_timeline`：交付前自检（常驻 workflow 工具）。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §4.10 / §5.3。
 *
 * 它是**纯前端、零网络、零成本**的一条（AC-05）：结果完全由 `ToolContext` 里的
 * 时间线与素材决定，所以按需加载会白费一个整回合 —— 直接进常驻
 * `workflow_tools` 与 `CORE_TOOLKIT_TOOL_NAMES`。
 *
 * 工具不做任何修复：只输出 issue + `suggested_tool`，由模型决定是否修
 * （§3.5「让 check_timeline 自动修复」被明确否决）。
 */

/**
 * `aspect_ratio` 的闭集字面量。
 *
 * 这里刻意重复一份而不是在模块顶层读 `qualityLint.LINT_ASPECT_RATIOS`：
 * `tools/index.ts` → `qualityTool.ts` → `qualityLint.ts` → `tools/index.ts` 是一个
 * ESM 循环，求值顺序不保证 `LINT_ASPECT_RATIOS` 已初始化（先 import qualityLint
 * 的入口会拿到 undefined 而抛 TypeError）。两份取值的一致性由
 * `__tests__/qualityLint.test.ts` 钉住。
 */
const ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1', '21:9'] as const;

const parameters = Type.Object({
  aspect_ratio: Type.Optional(Type.Union(
    ASPECT_RATIOS.map(ratio => Type.Literal(ratio)),
    {
      description:
        'Export frame to check subtitles and upscaling against. Default 16:9.',
    },
  )),
  include_notes: Type.Optional(Type.Boolean({
    description:
      'Also return note-level issues (optional polish). Default false.',
  })),
});

type Params = Static<typeof parameters>;

export function createCheckTimelineTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'check_timeline',
    label: 'Check Timeline',
    description:
      'Free local static check of the timeline: 16 rules, no network, no model '
      + 'call. Run it before export and after edits; fix blockers first. Each '
      + 'issue names the tool that fixes it.',
    parameters,

    execute: async (_toolCallId: string, params: Params) => {
      const target = defaultTargetResolution(params.aspect_ratio ?? '16:9');
      const report = lintTimeline({
        timelineState: context.timelineState,
        materials: context.materials,
        targetWidth: target.width,
        targetHeight: target.height,
        includeNotes: params.include_notes === true,
      });
      return toolkitResult({ success: true, ...report });
    },
  };
}
