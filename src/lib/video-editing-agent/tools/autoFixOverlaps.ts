import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext, TimelineOperation } from '../types';
import { packOverlappingTracks } from '../reconcile';
import { ItemPlacementService } from '@/components/video/timeline/domain/services/ItemPlacementService';
import { summarizeOverlapReport } from './checkOverlaps';
import { collectClipStarts, diffClipStarts, type ShiftedClip } from './index';

const parameters = Type.Object({
  trackIds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        '可选：限定只检查这些轨道。省略时检查所有 video/audio 非锁定轨道（subtitle 与 locked 轨道始终跳过）。',
    }),
  ),
});
type Params = Static<typeof parameters>;

/**
 * `auto_fix_overlaps` — pack-flush, from time 0 in startTime order, only the
 * reorganisable tracks that actually contain a same-track overlap. The
 * strategy matches `TimelineAggregate.organizeVideoAudioTracks`, so the result
 * is identical to what the UI would produce after a drag-commit.
 *
 * Tracks without an overlap are left exactly as they are: packing a
 * narration track that merely had a gap slid it away from the subtitles
 * aligned to it. Subtitle tracks and locked tracks are always untouched.
 *
 * Output contract: the resulting `move_clip` operations are returned in
 * `details.operations: TimelineOperation[]`. The shared SSE → frontend path
 * (`AgentEventRouter.handleToolResult`) replays them as one batch, and every
 * replayed move goes through the same reconcile module, so both sides end up
 * with the same layout. We intentionally do NOT call `context.updateTimeline`
 * here — that would bind a single operation to this toolCallId in the
 * `operations` Map (last-wins) and lose every move except the final one.
 *
 * Idempotency: if no overlaps exist, the tool returns
 * `{ noop: true, fixedCount: 0 }`. The system prompt instructs the LLM to stop
 * the reflect-fix loop after two consecutive `fixedCount=0` responses, so
 * this signal is the LLM's primary stop condition.
 */
export function createAutoFixOverlapsTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'auto_fix_overlaps',
    label: 'Auto Fix Overlaps',
    description:
      '自动修复同轨重叠：只对存在重叠的视频/音频轨道"按 startTime 排序后从 0 开始打紧"，没有重叠的轨道保持不变；字幕轨道与锁定轨道跳过。可选 trackIds 限定范围。返回 fixedCount=已移动的片段数、fixedTrackIds=被修复的轨道、shiftedClips=每个片段的起止位置，noop=true 表示没有需要修复的重叠。配合 check_timeline_overlaps 形成"检查 → 修复 → 再检查"闭环。',
    parameters,

    execute: async (_toolCallId, params: Params) => {
      const filter = params.trackIds ? { trackIds: params.trackIds } : undefined;
      // Pre-scan to provide accurate diagnostics (the in-place mutation
      // erases the original layout).
      const before = ItemPlacementService.findAllOverlaps(context.timelineState.tracks, filter);
      const allTrackIds = context.timelineState.tracks.map(track => track.id);
      const startsBefore = collectClipStarts(context.timelineState, allTrackIds);

      const { fixedTrackIds, operations } = packOverlappingTracks(context.timelineState, undefined, filter);
      const shiftedClips: ShiftedClip[] = diffClipStarts(
        startsBefore,
        collectClipStarts(context.timelineState, allTrackIds),
        '',
      );

      // Defensive: re-scan after pack to confirm we left no overlaps behind.
      const after = ItemPlacementService.findAllOverlaps(context.timelineState.tracks, filter);

      const noop = operations.length === 0;
      const result: {
        success: true;
        noop: boolean;
        fixedCount: number;
        fixedTrackIds: string[];
        changedTrackIds: string[];
        shiftedClips?: ShiftedClip[];
        overlapsBefore: number;
        overlapsAfter: number;
        operations: TimelineOperation[];
        message: string;
        warning?: string;
      } = {
        success: true,
        noop,
        fixedCount: operations.length,
        fixedTrackIds,
        changedTrackIds: fixedTrackIds,
        ...(shiftedClips.length > 0 ? { shiftedClips } : {}),
        overlapsBefore: before.length,
        overlapsAfter: after.length,
        operations,
        message: noop
          ? '✅ 没有可自动修复的同轨重叠，时间线保持不变。'
          : `🛠 已修复 ${fixedTrackIds.length} 条存在重叠的轨道，移动 ${operations.length} 个片段。`,
      };

      // Surface unresolved overlaps (e.g. on subtitle / locked tracks the
      // pack-flush strategy cannot reach) so the LLM doesn't loop on them.
      if (after.length > 0) {
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
