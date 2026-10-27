import type { AgentToolCallRecord, ChatMessage, TimelineItem, Track } from '@/types';

/**
 * 回合总结：本轮改了什么、有没有遗留问题。纯函数，输入只来自已落盘的
 * `agentToolCalls` 与 `timelineTrackPatches`，无网络、无副作用。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.4.3。
 */

export interface TurnSummary {
  clips: { added: number; removed: number; moved: number; trimmed: number; resized: number };
  materials: {
    imported: number;
    generated: { tts: number; image: number; video: number };
    webDownloaded: number;
  };
  /** 取本回合最后一次 `check_timeline`；没跑过为 null。 */
  check: { blockers: number; warnings: number; unlicensed: number } | null;
  failedTools: number;
  /** 与「撤销本轮」的可用性一致：记录了轨道补丁且尚未撤销。 */
  hasUndoable: boolean;
  /** 回合被停止或出错：只展示精简版（已完成 N 步，可撤销）。 */
  partial: boolean;
  /** 已完成的工具步数（精简版的主数字）。 */
  completedSteps: number;
}

const IMPORT_TOOLS = new Set([
  'add_material_to_library', 'workspace_import_material', 'download_web_media',
  'fetch_web_image',
]);
const WEB_DOWNLOAD_TOOLS = new Set(['download_web_media', 'fetch_web_image']);
const TTS_TOOLS = new Set(['generate_tts', 'batch_generate_tts']);
const IMAGE_TOOLS = new Set(['generate_ai_image']);
const VIDEO_TOOLS = new Set(['generate_ai_video', 'image_to_video', 'batch_storyboard_video']);
const LICENSE_RULE = 'web_material_license_unknown';

function succeeded(call: AgentToolCallRecord): boolean {
  if (call.status !== 'completed') return false;
  const result = call.result as { success?: unknown } | undefined;
  return result?.success !== false;
}

function indexItems(tracks: readonly (Track | null)[]): Map<string, TimelineItem> {
  const items = new Map<string, TimelineItem>();
  for (const track of tracks) {
    for (const item of track?.items ?? []) items.set(item.id, item);
  }
  return items;
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  return Math.abs((a ?? 0) - (b ?? 0)) < 1e-6;
}

/** 补丁前后对比出片段的增/删/移动/裁剪/变速（时长变化）。 */
function countClipChanges(message: ChatMessage): TurnSummary['clips'] {
  const clips = { added: 0, removed: 0, moved: 0, trimmed: 0, resized: 0 };
  const patches = message.timelineTrackPatches ?? [];
  const before = indexItems(patches.map(patch => patch.before));
  const after = indexItems(patches.map(patch => patch.after));
  after.forEach((item, id) => {
    const previous = before.get(id);
    if (!previous) { clips.added += 1; return; }
    if (previous.trackId !== item.trackId || !sameNumber(previous.startTime, item.startTime)) {
      clips.moved += 1;
    }
    if (!sameNumber(previous.clipStart, item.clipStart)
      || !sameNumber(previous.clipEnd, item.clipEnd)) clips.trimmed += 1;
    if (!sameNumber(previous.duration, item.duration)) clips.resized += 1;
  });
  before.forEach((_item, id) => { if (!after.has(id)) clips.removed += 1; });
  return clips;
}

function latestCheck(calls: readonly AgentToolCallRecord[]): TurnSummary['check'] {
  const call = [...calls].reverse().find(item => item.name === 'check_timeline' && succeeded(item));
  if (!call) return null;
  const result = call.result as {
    blockers?: number; warnings?: number; issues?: Array<{ code?: string }>;
  };
  const unlicensed = (result.issues ?? []).filter(issue => issue.code === LICENSE_RULE).length;
  return { blockers: result.blockers ?? 0, warnings: result.warnings ?? 0, unlicensed };
}

function countByName(calls: readonly AgentToolCallRecord[], names: ReadonlySet<string>): number {
  return calls.filter(call => names.has(call.name) && succeeded(call)).length;
}

/**
 * `null`：流式中，或没有任何已完成的工具调用（没什么可总结）。
 * 被停止/出错的回合返回 `partial: true`，由卡片展示精简版。
 */
export function summarizeTurn(message: ChatMessage): TurnSummary | null {
  if (message.isStreaming || !message.isAgentMessage) return null;
  const calls = message.agentToolCalls ?? [];
  const completedSteps = calls.filter(call => call.status === 'completed').length;
  if (completedSteps === 0) return null;
  return {
    clips: countClipChanges(message),
    materials: {
      imported: countByName(calls, IMPORT_TOOLS),
      generated: {
        tts: countByName(calls, TTS_TOOLS),
        image: countByName(calls, IMAGE_TOOLS),
        video: countByName(calls, VIDEO_TOOLS),
      },
      webDownloaded: countByName(calls, WEB_DOWNLOAD_TOOLS),
    },
    check: latestCheck(calls),
    failedTools: calls.filter(call => call.status === 'error').length,
    hasUndoable: (message.timelineTrackPatches?.length ?? 0) > 0 && !message.isUndone,
    partial: message.isCancelled === true,
    completedSteps,
  };
}

/** 有任何值得展示的指标。全零时卡片不渲染，避免空壳。 */
export function hasSummaryContent(summary: TurnSummary): boolean {
  const { clips, materials } = summary;
  return clips.added + clips.removed + clips.moved + clips.trimmed + clips.resized > 0
    || materials.imported + materials.webDownloaded > 0
    || materials.generated.tts + materials.generated.image + materials.generated.video > 0
    || summary.check !== null || summary.failedTools > 0 || summary.partial;
}
