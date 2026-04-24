import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext, TimelineOperation } from '../types';
import { packAllReorganisableTracks } from '../reconcile';
import { ItemPlacementService } from '@/components/video/timeline/domain/services/ItemPlacementService';
import { summarizeOverlapReport } from './checkOverlaps';

const parameters = Type.Object({
  trackIds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        '可选：限定只对这些轨道执行打紧。省略时对所有 video/audio 非锁定轨道生效（subtitle 与 locked 轨道始终跳过）。',
    }),
  ),
});
type Params = Static<typeof parameters>;

/**
 * `auto_fix_overlaps` — pack-flush every reorganisable track from time 0 in
 * startTime order, eliminating same-track overlaps. The strategy matches
 * `TimelineAggregate.organizeVideoAudioTracks` so the result is identical to
 * what the UI would produce after a drag-commit.
 *
 * Subtitle tracks and locked tracks are intentionally untouched (subtitles
 * carry tight audio alignment; locked tracks belong to the user).
 *
 * Output contract: the resulting `move_clip` operations are returned in
 * `details.operations: TimelineOperation[]`. The shared SSE → frontend path
 * (`AgentEventRouter.handleToolResult`) already detects this field and
 * applies the operations one-by-one (the same path used by
 * `compose_storyboard`). We intentionally do NOT call `context.updateTimeline`
 * here — that would bind a single operation to this toolCallId in the
 * `operations` Map (last-wins) and lose every move except the final one.
 *
 * Idempotency: if no overlaps exist (or every track is already packed), the
 * tool returns `{ noop: true, fixedCount: 0 }`. The system prompt instructs
 * the LLM to stop the reflect-fix loop after two consecutive `fixedCount=0`
 * responses, so this signal is the LLM's primary stop condition.
 */
export function createAutoFixOverlapsTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'auto_fix_overlaps',
    label: 'Auto Fix Overlaps',
    description:
      '通过"按 startTime 排序后从 0 开始打紧"自动修复同轨重叠。视频/音频轨道生效，字幕轨道与锁定轨道跳过。可选 trackIds 限定范围。返回 fixedCount=已移动的片段数，noop=true 表示无重叠或已是最紧布局。配合 check_timeline_overlaps 形成"检查 → 修复 → 再检查"闭环。',
    parameters,

    execute: async (_toolCallId, params: Params) => {
      // Pre-scan to provide accurate diagnostics (the in-place mutation by
      // packAllReorganisableTracks erases the original layout).
      const before = ItemPlacementService.findAllOverlaps(
        context.timelineState.tracks,
        params.trackIds ? { trackIds: params.trackIds } : undefined,
      );

      const { changedTrackIds, operations } = packAllReorganisableTracks(
        context.timelineState,
        params.trackIds ? { trackIds: params.trackIds } : undefined,
      );

      // Defensive: re-scan after pack to confirm we left no overlaps behind.
      const after = ItemPlacementService.findAllOverlaps(
        context.timelineState.tracks,
        params.trackIds ? { trackIds: params.trackIds } : undefined,
      );

      const noop = operations.length === 0;
      const fullyResolved = after.length === 0;

      const result: {
        success: true;
        noop: boolean;
        fixedCount: number;
        changedTrackIds: string[];
        overlapsBefore: number;
        overlapsAfter: number;
        operations: TimelineOperation[];
        message: string;
        warning?: string;
      } = {
        success: true,
        noop,
        fixedCount: operations.length,
        changedTrackIds,
        overlapsBefore: before.length,
        overlapsAfter: after.length,
        operations,
        message: noop
          ? before.length === 0
            ? '✅ 时间线无重叠，无需调整。'
            : '✅ 涉及轨道已经是最紧布局（startTime 已按顺序紧贴）。'
          : `🛠 已对 ${changedTrackIds.length} 条轨道执行 pack-flush，移动 ${operations.length} 个片段。`,
      };

      // Surface unresolved overlaps (e.g. cross-track conflicts the
      // pack-flush strategy cannot reach) so the LLM doesn't loop on them.
      if (!fullyResolved) {
        result.warning = `仍有 ${after.length} 处重叠未被自动解决（可能位于 subtitle / 锁定轨道，或需手动 move_clip / resize_clip）：\n${after
          .map(summarizeOverlapReport)
          .join('\n')}`;
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
