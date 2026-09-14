import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { ItemPlacementService, type OverlapReport } from '@/components/video/timeline/domain/services/ItemPlacementService';
import { describeOverlaps } from './index';

const parameters = Type.Object({});
type Params = Static<typeof parameters>;

/**
 * Format a single overlap report into a short human-readable line. Used in
 * `summary` so the LLM can see what's wrong at a glance without parsing
 * the structured `overlaps` array.
 */
export function summarizeOverlapReport(r: OverlapReport): string {
  const len = (r.overlapEnd - r.overlapStart).toFixed(2);
  return `track=${r.trackId}(${r.trackType}): ${r.a.clipId} [${r.a.startTime.toFixed(2)}-${r.a.endTime.toFixed(2)}] ⨯ ${r.b.clipId} [${r.b.startTime.toFixed(2)}-${r.b.endTime.toFixed(2)}] (overlap=${len}s)`;
}

export function createCheckOverlapsTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'check_timeline_overlaps',
    label: 'Check Timeline Overlaps',
    description:
      '检查时间线是否存在同轨重叠的片段。返回 valid=true 表示无重叠；valid=false 时 overlaps 列出全部冲突对（含 trackId、两个 clipId、重叠区间、autoFixable）。autoFixable=false 表示重叠位于字幕轨或锁定轨，auto_fix_overlaps 无法修复。每轮 add_to_track / move_clip / resize_clip / trim_clip / compose_storyboard 复合编辑结束后必须调用一次。',
    parameters,

    execute: async (_toolCallId: string, _params: Params) => {
      const reports = ItemPlacementService.findAllOverlaps(context.timelineState.tracks);
      const overlaps = describeOverlaps(context.timelineState, reports);
      const autoFixableCount = overlaps.filter(overlap => overlap.autoFixable).length;
      const manualOnlyCount = overlaps.length - autoFixableCount;

      const summaryLines = [
        `⚠️ 发现 ${reports.length} 处重叠：`,
        ...reports.map(summarizeOverlapReport),
        ...(autoFixableCount > 0
          ? ['请调用 auto_fix_overlaps 自动修复 autoFixable=true 的重叠，或使用 move_clip / resize_clip / trim_clip 手动调整。']
          : []),
        // Without this the model looped on overlaps the fixer always skips.
        ...(manualOnlyCount > 0
          ? [`其中 ${manualOnlyCount} 处位于字幕轨或锁定轨（autoFixable=false），auto_fix_overlaps 无法修复；除非用户要求，否则忽略这些重叠，不要反复调用修复工具。`]
          : []),
      ];

      const result = {
        success: true,
        valid: reports.length === 0,
        overlapCount: reports.length,
        autoFixableCount,
        overlaps,
        summary: reports.length === 0 ? '✅ 时间线上没有同轨重叠的片段。' : summaryLines.join('\n'),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
