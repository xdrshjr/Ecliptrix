import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { ItemPlacementService, type OverlapReport } from '@/components/video/timeline/domain/services/ItemPlacementService';

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
      '检查时间线是否存在同轨重叠的片段。返回 valid=true 表示无重叠；valid=false 时 overlaps 列出全部冲突对（含 trackId、两个 clipId、重叠区间）。每轮 add_to_track / move_clip / resize_clip / trim_clip / compose_storyboard 复合编辑结束后必须调用一次。',
    parameters,

    execute: async (_toolCallId: string, _params: Params) => {
      const overlaps = ItemPlacementService.findAllOverlaps(context.timelineState.tracks);
      const summaryLines = overlaps.map(summarizeOverlapReport);

      const result = {
        success: true,
        valid: overlaps.length === 0,
        overlapCount: overlaps.length,
        overlaps: overlaps.map(r => ({
          trackId: r.trackId,
          trackType: r.trackType,
          clipAId: r.a.clipId,
          clipBId: r.b.clipId,
          overlapStart: r.overlapStart,
          overlapEnd: r.overlapEnd,
        })),
        summary:
          overlaps.length === 0
            ? '✅ 时间线上没有同轨重叠的片段。'
            : `⚠️ 发现 ${overlaps.length} 处重叠：\n${summaryLines.join('\n')}\n请调用 auto_fix_overlaps 自动修复，或使用 move_clip / resize_clip / trim_clip 手动调整。`,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  };
}
