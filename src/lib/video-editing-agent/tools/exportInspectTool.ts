import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { getVideoTrackMaxDuration } from './index';
import { executeVisionTool, resolveCompositionId } from './visionAdapter';

/**
 * `inspect_export`：交付前的成品自检。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §4.9 / §5.3。
 *
 * 技术探测（时长/流/黑帧/静音/响度）与视觉抽检**互相独立**：没有视觉模型
 * 恰恰是最需要探测成片的时候，所以视觉部分不可用只会把它记进 `skipped[]`，
 * 工具仍然返回完整的技术指标（§5.2 的 P1-5 修正）。
 */

const parameters = Type.Object({
  composition_id: Type.Optional(Type.String({
    description:
      'Exported composition id. May be omitted: the app uses the most recent '
      + 'export of this project.' })),
  expected: Type.Optional(Type.Object({
    width: Type.Optional(Type.Integer({ minimum: 1, maximum: 16_384,
      description: 'Expected output width in pixels.' })),
    height: Type.Optional(Type.Integer({ minimum: 1, maximum: 16_384,
      description: 'Expected output height in pixels.' })),
  }, { description: 'Expected resolution, purely advisory for the mismatch check.' })),
  check_audio: Type.Optional(Type.Boolean({
    description: 'Run silence and loudness checks (default true).' })),
  visual_spot_check: Type.Optional(Type.Boolean({
    description:
      'Sample frames and look at them with the vision model (default true). '
      + 'Sets skipped[] when vision is not available.' })),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 6,
    description: 'Frames to sample for the visual spot check (default 4).' })),
});

type InspectParams = Static<typeof parameters>;

/** 时长只用于一致性比对，3 位小数足够，也避免浮点噪声进 JSON。 */
function roundDuration(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

function expectedSize(
  expected: InspectParams['expected'],
): Record<string, number> | undefined {
  const size: Record<string, number> = {};
  if (typeof expected?.width === 'number' && expected.width > 0) {
    size.width = expected.width;
  }
  if (typeof expected?.height === 'number' && expected.height > 0) {
    size.height = expected.height;
  }
  return Object.keys(size).length ? size : undefined;
}

export function createInspectExportTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'inspect_export',
    label: 'Inspect Export',
    description:
      'Probe the exported video: duration, resolution, black frames, silence, '
      + 'loudness, optional frame check. Only exports from this app session, '
      + 'made in the last hour.',
    parameters,
    execute: async (toolCallId: string, params: InspectParams) => {
      const compositionId = resolveCompositionId(context, params.composition_id);
      const timelineDuration = getVideoTrackMaxDuration(context.timelineState);
      const expected = expectedSize(params.expected);
      return executeVisionTool(context, toolCallId, {
        path: '/export-inspect',
        body: {
          project_id: context.projectId ?? null,
          // 省略时**不发**该字段：后端依次回落到「最近一次 completed 合成」，
          // 显式传空串会把回落路径堵死（§4.4 的 P1-1 规则）。
          ...(compositionId ? { composition_id: compositionId } : {}),
          ...(timelineDuration > 0
            ? { timeline_duration: roundDuration(timelineDuration) } : {}),
          ...(expected ? { expected } : {}),
          check_audio: params.check_audio ?? true,
          visual_spot_check: params.visual_spot_check ?? true,
          count: params.count ?? 4,
        },
        // 探测窗口的语义（进程内 + 1 小时）由后端返回，但解释权在这里：
        // 模型看到这条才不会再拿一个过期 id 重试。
        ...(compositionId ? {} : {
          nextStep: 'If this reports composition_not_found, ask the user to '
            + 'export again and call inspect_export right away.',
        }),
      });
    },
  };
}
