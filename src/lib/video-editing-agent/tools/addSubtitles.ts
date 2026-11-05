import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type {
  AddSubtitleClipsOperation,
  AgentSubtitleClipData,
  AgentSubtitleCue,
  SubtitleStyle,
  Track,
} from '@/types';
import type { ToolContext } from '../types';
import {
  MAX_TRACK_CUES,
  findCueConflicts,
  normalizeSubtitleStyle,
  resolveSubtitleTrackId,
  subtitleClipName,
  subtitleStyleProblem,
} from '../subtitleClips';
import { SubtitleParseError, parseSrtCues } from '../subtitleSrt';
import { subtitleRejection, type SubtitleGuardResult } from './subtitleGuard';
import { executeToolkitRaw, resolveProjectId } from './toolkitAdapter';
import { LINT_DEFAULTS, defaultTargetResolution } from './qualityLint';
import {
  maxSubtitleChars,
  wrapSubtitleText,
} from '@/components/video/lib/subtitleLayout';
import {
  checkTrackDurationConstraint,
  formatDurationWarning,
} from './index';

/**
 * `add_subtitles`：把「文本 + 时间」直接写成字幕轨（spec §6.1 / D-1）。
 *
 * 为什么需要一个新工具，而不是让 `add_to_track` 收一段文本：`add_to_track` 的
 * 语义是「素材上轨」，字幕没有素材——用户日志里 Agent 正是卡在「素材库 0 条」
 * 和「workspace_import_material 拒绝 .srt」这两步上，结构上无法创建任何一条
 * 字幕（R1–R5）。
 *
 * 三条纪律：
 *  1. **不抛异常**：所有失败都 `return` 带 `success:false` + `error_code` 的
 *     正常结果，熔断器才不会把一次可自纠的输入错误升级成整轮中断（D-8）。
 *  2. **不静默改写文本**：行字数、行数只回给模型，断句是内容决策（D-7）。
 *  3. **据回执说话**：本地副本拒绝时回 `subtitle_apply_refused`，不报 success
 *     （D-4 / P0-2）。
 */

/**
 * 画幅闭集：与 `qualityTool.ts` 同样的字面量副本。
 *
 * `tools/index` → `qualityTool` → `qualityLint` → `tools/index` 是一个 ESM 循环，
 * 顶层读 `LINT_ASPECT_RATIOS`（`const`）有 TDZ 风险；函数声明是提升的，所以
 * `defaultTargetResolution` 可以在 execute 里安全调用。两份取值的一致性由
 * `subtitleDisclosure.test.ts` 钉住。
 */
const ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1', '21:9'] as const;

/** 单次调用上限（V2 / D-2）。 */
const MAX_CUES_PER_CALL = 120;
/** 单条文本上限（V4）；超出通常是模型把整段文案塞进了一条。 */
const MAX_CUE_CHARS = 200;
/** 内联 `srt` 上限；更大的文件走 `srt_workspace_path`（V2）。 */
const MAX_SRT_CHARS = 20_000;
/** 工作区 SRT 总上限与分页大小（V12 / §6.5）。 */
const MAX_WORKSPACE_BYTES = 64 * 1024;
const WORKSPACE_PAGE_BYTES = 8000;
/** 循环保护：16 × 8 KB > 64 KB，字节上限会先触发。 */
const MAX_PAGES = 16;
/** 结果里最多回几条 cue（RK-5：别把全文再贴一遍）。 */
const RESULT_CUE_LIMIT = 20;

const cueSchema = Type.Object({
  text: Type.String({ description: 'Subtitle text (one or two short lines).' }),
  startTime: Type.Number({ description: 'Start on the timeline in seconds, >= 0.' }),
  duration: Type.Number({ description: 'Seconds on screen, > 0.' }),
});

const parameters = Type.Object({
  cues: Type.Optional(Type.Array(cueSchema, {
    description: 'Up to 120 cues. The usual way to add subtitles.',
  })),
  srt: Type.Optional(Type.String({
    description: 'SRT text (at most 20000 characters).',
  })),
  srt_workspace_path: Type.Optional(Type.String({
    description:
      'Workspace SRT path such as "subtitle/yorkie.srt". The tool pages the file '
      + 'in itself, so prefer it over pasting a long srt.',
  })),
  mode: Type.Optional(Type.Union(
    [Type.Literal('append'), Type.Literal('replace')],
    {
      description:
        "Default 'append'. 'replace' rewrites the whole subtitle track in one "
        + 'undoable step — only use it when the user asked to redo the track.',
    },
  )),
  trackId: Type.Optional(Type.String({
    description: 'Target subtitle track. Omit to use the first subtitle track, or to create one.',
  })),
  aspect_ratio: Type.Optional(Type.Union(
    ASPECT_RATIOS.map(ratio => Type.Literal(ratio)),
    {
      description:
        'Export frame the per-line character budget is computed for. Default 16:9 '
        + '(9:16 fits ~16 CJK chars per line, 16:9 ~30).',
    },
  )),
  style: Type.Optional(Type.Object({
    fontFamily: Type.Optional(Type.String({
      description: 'default | serif | sans-serif | monospace',
    })),
    fontSize: Type.Optional(Type.Number({ description: '8..72 pixels. Default 60.' })),
    fontColor: Type.Optional(Type.String({ description: '#RRGGBB. Default #FFFFFF.' })),
    backgroundColor: Type.Optional(Type.String({
      description: '#RRGGBB. Omit for no background.',
    })),
    position: Type.Optional(Type.String({
      description: 'top | center | bottom | upper-3/4 | lower-3/4. Default bottom.',
    })),
  })),
});

type Params = Static<typeof parameters>;

/** 三个来源里到底给了几个（V1）。 */
function givenSources(params: Params): Array<'cues' | 'srt' | 'srt_workspace_path'> {
  const given: Array<'cues' | 'srt' | 'srt_workspace_path'> = [];
  if (params.cues !== undefined) given.push('cues');
  if (params.srt !== undefined) given.push('srt');
  if (params.srt_workspace_path !== undefined) given.push('srt_workspace_path');
  return given;
}

/**
 * 读工作区 SRT 全文（§6.5 / P0-1）。
 *
 * **必须走 `executeToolkitRaw`**：`executeToolkitTool` 会把结果压到 12 KiB 并把
 * 超过 1200 字符的字符串字段截断，1.1 KB 的 SRT 都会读残，工具却照样回 success。
 * EOF 判据是返回的 `next_offset === null`——不是 `content` 的长度，CJK 会被字节
 * 边界切开。
 */
async function readWorkspaceSrt(
  context: ToolContext,
  toolCallId: string,
  path: string,
): Promise<{ ok: true; text: string } | { ok: false; rejection: SubtitleGuardResult }> {
  let offset = 0;
  let text = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await executeToolkitRaw(context, `${toolCallId}-srt-${page}`, {
      path: '/workspace/read',
      query: {
        project_id: resolveProjectId(context),
        name: path,
        offset,
        max_bytes: WORKSPACE_PAGE_BYTES,
      },
    });
    if (!result.ok) {
      return {
        ok: false,
        rejection: subtitleRejection(result.code, { path }, result.nextStep),
      };
    }
    const data = result.data;
    const content = typeof data.content === 'string' ? data.content : '';
    const totalBytes = typeof data.total_bytes === 'number' ? data.total_bytes : 0;
    // 先按总长预判，不要读完 64 KB 才发现太大。
    if (page === 0 && totalBytes > MAX_WORKSPACE_BYTES) {
      return {
        ok: false,
        rejection: subtitleRejection('subtitle_workspace_too_large', {
          path, total_bytes: totalBytes,
        }),
      };
    }
    text += content;
    // `next_offset === null` 是契约里的 EOF（§6.5）。缺失或倒退的 offset 只有在
    // 后端**同时**声明还有内容时才判异常——静默返回半份 SRT 正是 P0-1 要防的
    // 那种「工具回 success、字幕却少一半」。
    const next = data.next_offset;
    if (typeof next === 'number' && next > offset) {
      offset = next;
      continue;
    }
    if (data.truncated === true) {
      return {
        ok: false,
        rejection: subtitleRejection('invalid_offset', { path, offset },
          'Re-read the file with srt_workspace_path again; the tool pages it itself.'),
      };
    }
    return { ok: true, text };
  }
  return {
    ok: false,
    rejection: subtitleRejection('subtitle_workspace_too_large', { path }),
  };
}

/** 来源 → cue 列表（三选一，其余校验由调用方做）。 */
async function collectCues(
  context: ToolContext,
  toolCallId: string,
  params: Params,
): Promise<
  { ok: true; cues: AgentSubtitleCue[] }
  | { ok: false; rejection: SubtitleGuardResult }
> {
  if (params.cues !== undefined) {
    return {
      ok: true,
      cues: params.cues.map(cue => ({
        text: cue.text, startTime: cue.startTime, duration: cue.duration,
      })),
    };
  }
  let srtText: string;
  if (params.srt !== undefined) {
    if (params.srt.length > MAX_SRT_CHARS) {
      return {
        ok: false,
        rejection: subtitleRejection('subtitle_source_too_large', {
          chars: params.srt.length, limit: MAX_SRT_CHARS,
        }),
      };
    }
    srtText = params.srt;
  } else {
    const read = await readWorkspaceSrt(context, toolCallId,
      params.srt_workspace_path as string);
    if (!read.ok) return { ok: false, rejection: read.rejection };
    srtText = read.text;
  }
  try {
    return { ok: true, cues: parseSrtCues(srtText) };
  } catch (error) {
    // 解析失败是**输入**问题：回可读的结构化错误，绝不向上抛（D-8）。
    const line = error instanceof SubtitleParseError ? error.line : 1;
    const reason = error instanceof SubtitleParseError
      ? error.reason
      : 'the SRT could not be parsed';
    return {
      ok: false,
      rejection: subtitleRejection('subtitle_parse_failed', {
        line,
        reason,
        snippet: srtText.split('\n')[line - 1]?.slice(0, 80) ?? '',
      }),
    };
  }
}

/** 单条 cue 的文本与时间（V3–V5）；`null` 表示合法。 */
function cueProblem(cues: readonly AgentSubtitleCue[]) {
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const text = cue.text?.trim() ?? '';
    if (text.length === 0 || Array.from(text).length > MAX_CUE_CHARS) {
      return subtitleRejection('subtitle_text_invalid', {
        index, chars: Array.from(text).length, limit: MAX_CUE_CHARS,
      });
    }
    const timeValid = Number.isFinite(cue.startTime) && cue.startTime >= 0
      && Number.isFinite(cue.duration) && cue.duration > 0;
    if (!timeValid) {
      return subtitleRejection('subtitle_time_invalid', {
        index, startTime: cue.startTime, duration: cue.duration,
      });
    }
  }
  return null;
}

/** 目标轨解析 + 锁/类型校验（V8 / RK-3）。 */
function resolveTargetTrack(
  context: ToolContext,
  params: Params,
): { ok: true; trackId: string; track?: Track } | { ok: false; rejection: SubtitleGuardResult } {
  const state = context.timelineState;
  if (params.trackId === undefined) {
    const trackId = resolveSubtitleTrackId(state);
    const track = state.tracks.find(candidate => candidate.id === trackId);
    if (track?.isLocked) {
      return { ok: false, rejection: subtitleRejection('subtitle_track_locked', { trackId }) };
    }
    return { ok: true, trackId, track };
  }
  const track = state.tracks.find(candidate => candidate.id === params.trackId);
  if (!track || track.type !== 'subtitle') {
    return {
      ok: false,
      rejection: subtitleRejection('subtitle_track_wrong_type', {
        trackId: params.trackId,
        found: track ? track.type : 'missing',
      }),
    };
  }
  if (track.isLocked) {
    return {
      ok: false,
      rejection: subtitleRejection('subtitle_track_locked', { trackId: track.id }),
    };
  }
  return { ok: true, trackId: track.id, track };
}

/** 确定性条目 id（D-10）：同一 toolCallId 重放得到同一批 id，配合 upsert 幂等。 */
function buildClips(
  cues: readonly AgentSubtitleCue[],
  toolCallId: string,
): AgentSubtitleClipData[] {
  const safeCallId = toolCallId.replace(/[^A-Za-z0-9_-]/g, '');
  return cues
    .map((cue, index) => ({ cue, index }))
    .sort((left, right) => left.cue.startTime - right.cue.startTime
      || left.index - right.index)
    .map(({ cue }, index) => ({
      id: `subtitle-${safeCallId}-${index}`,
      name: subtitleClipName(cue.text),
      text: cue.text.trim(),
      startTime: cue.startTime,
      duration: cue.duration,
    }));
}

/** 超过 `subtitleMaxLines` 行的条目（V10）；不拒绝，只告警（D-7）。 */
function overflowWarnings(
  clips: readonly AgentSubtitleClipData[],
  lineBudget: number,
) {
  const warnings: Array<Record<string, unknown>> = [];
  clips.forEach((clip, index) => {
    const lines = wrapSubtitleText(clip.text, lineBudget);
    if (lines.length <= LINT_DEFAULTS.subtitleMaxLines) return;
    warnings.push({
      index,
      chars: Array.from(clip.text).length,
      lines: lines.length,
      lineBudget,
      text: clip.text.slice(0, 40),
    });
  });
  return warnings;
}

/** 结果里的 cue 摘要（前 20 条，其余用 `cuesOmitted` 交代）。 */
function describeClips(clips: readonly AgentSubtitleClipData[], lineBudget: number) {
  const shown = clips.slice(0, RESULT_CUE_LIMIT).map(clip => ({
    id: clip.id,
    startTime: clip.startTime,
    duration: clip.duration,
    text: clip.text,
    lines: wrapSubtitleText(clip.text, lineBudget).length,
  }));
  return { cues: shown, cuesOmitted: Math.max(0, clips.length - shown.length) };
}

/** V1：三个来源必须且只能给一个（§6.1）。 */
function sourceProblem(params: Params): SubtitleGuardResult | null {
  const given = givenSources(params);
  if (given.length === 0) return subtitleRejection('subtitle_source_missing');
  if (given.length > 1) {
    return subtitleRejection('subtitle_source_ambiguous', { given });
  }
  return null;
}

/** V2–V5：条数与单条文本/时间；`null` 表示整批可下发。 */
function cuesProblem(
  cues: readonly AgentSubtitleCue[],
): SubtitleGuardResult | null {
  if (cues.length === 0) {
    return subtitleRejection('subtitle_text_invalid',
      { reason: 'no cues found in the source' });
  }
  if (cues.length > MAX_CUES_PER_CALL) {
    return subtitleRejection('subtitle_too_many_cues',
      { count: cues.length, limit: MAX_CUES_PER_CALL });
  }
  return cueProblem(cues);
}

/** 行字数预算的口径：画幅 + 样式（D-13 / V9 / V13）。 */
interface FrameBudget {
  aspectRatio: '16:9' | '9:16' | '4:3' | '1:1' | '21:9';
  style: SubtitleStyle;
  lineBudget: number;
}

/**
 * 画幅与样式（D-13）：`lineBudget` 必须按**真实画幅**算——9:16 是 16 字/行、
 * 16:9 是 30，写死 16:9 会让 V10 这条护栏在竖屏工程里完全失效。
 */
function resolveFrame(params: Params):
  { ok: true; frame: FrameBudget } | { ok: false; rejection: SubtitleGuardResult } {
  const aspectRatio = params.aspect_ratio ?? '16:9';
  // V13：schema 已用闭集约束，这里仍挡一次（旧客户端 / 被篡改的载荷）。
  if (!ASPECT_RATIOS.includes(aspectRatio)) {
    return {
      ok: false,
      rejection: subtitleRejection('subtitle_aspect_invalid', {
        aspect_ratio: aspectRatio, allowed: ASPECT_RATIOS,
      }),
    };
  }
  const styleProblem = subtitleStyleProblem(params.style);
  if (styleProblem) {
    return {
      ok: false,
      rejection: subtitleRejection('subtitle_style_invalid',
        { reason: styleProblem, style: params.style }),
    };
  }
  const style = normalizeSubtitleStyle(params.style);
  return {
    ok: true,
    frame: {
      aspectRatio,
      style,
      lineBudget: maxSubtitleChars(
        defaultTargetResolution(aspectRatio).width, style.fontSize),
    },
  };
}

/** 一次已通过全部校验、可直接下发的写入。 */
interface SubtitleWrite {
  operation: AddSubtitleClipsOperation;
  trackId: string;
  addedCount: number;
  removedCount: number;
  clips: AgentSubtitleClipData[];
  lineBudget: number;
  assumedFrame: string;
}

/**
 * 目标轨 → 冲突 → 单轨上限 → 操作载荷（§4.2 第 5–7 步）。
 *
 * 同 id 的既有条目就是**上一次同一次调用**写下的（D-15 的 upsert 语义）：它们
 * 既不参与重叠判定，也不计入「新增」——否则 SSE 重放 / 同 turn 重试会撞上自己
 * 写过的字幕，回一个假冲突（AC-12 / I-3）。
 */
function planWrite(
  context: ToolContext,
  toolCallId: string,
  params: Params,
  cues: readonly AgentSubtitleCue[],
  frame: FrameBudget,
): { ok: true; write: SubtitleWrite }
  | { ok: false; rejection: SubtitleGuardResult } {
  const target = resolveTargetTrack(context, params);
  if (!target.ok) return target;
  const mode = params.mode ?? 'append';
  const existing = target.track?.items ?? [];
  const clips = buildClips(cues, toolCallId);
  const ownIds = new Set(clips.map(clip => clip.id));
  const foreign = existing.filter(item => !ownIds.has(item.id));
  const existingIds = new Set(existing.map(item => item.id));
  const addedCount = clips.filter(clip => !existingIds.has(clip.id)).length;
  const conflict = findCueConflicts(
    mode === 'replace' ? [] : foreign, cues);
  if (conflict) {
    const isExisting = conflict.existingIndex !== undefined;
    return {
      ok: false,
      rejection: subtitleRejection(
        isExisting ? 'subtitle_conflicts_existing' : 'subtitle_cues_overlap',
        { ...conflict, trackId: target.trackId },
      ),
    };
  }
  if (mode === 'append' && foreign.length + addedCount > MAX_TRACK_CUES) {
    return {
      ok: false,
      rejection: subtitleRejection('subtitle_track_full', {
        trackId: target.trackId,
        existing: existing.length,
        limit: MAX_TRACK_CUES,
      }),
    };
  }
  return {
    ok: true,
    write: {
      operation: {
        type: 'add_subtitle_clips',
        trackId: target.trackId,
        mode,
        style: frame.style,
        clips,
      },
      trackId: target.trackId,
      addedCount,
      removedCount: mode === 'replace' ? existing.length : 0,
      clips,
      lineBudget: frame.lineBudget,
      assumedFrame: frame.aspectRatio,
    },
  };
}

/** 成功结果（§6.1）：条数、行预算、溢出行与时长告警。 */
function describeWrite(context: ToolContext, write: SubtitleWrite) {
  const constraint = checkTrackDurationConstraint(context.timelineState);
  const warning = formatDurationWarning(constraint);
  return {
    success: true,
    trackId: write.trackId,
    mode: write.operation.mode,
    addedCount: write.addedCount,
    updatedCount: write.clips.length - write.addedCount,
    removedCount: write.removedCount,
    lineBudget: write.lineBudget,
    // 回显算预算用的画幅，模型才知道该按哪一列缩句（D-13）。
    assumedFrame: write.assumedFrame,
    ...describeClips(write.clips, write.lineBudget),
    overflowWarnings: overflowWarnings(write.clips, write.lineBudget),
    ...(warning ? { warning } : {}),
    lintHint:
      `Call check_timeline({aspect_ratio:"${write.assumedFrame}"}) to re-check `
      + 'subtitle_overflow / subtitle_overlap / subtitle_style_drift.',
  };
}

export function createAddSubtitlesTool(
  context: ToolContext,
): AgentTool<typeof parameters> {
  return {
    name: 'add_subtitles',
    label: 'Add Subtitles',
    description:
      'Write subtitles onto a subtitle track from text (no material needed). Give '
      + 'exactly ONE source: cues[] (text + startTime + duration), srt (SRT text), or '
      + 'srt_workspace_path (a workspace .srt written with workspace_write — the tool '
      + 'pages it in itself). Read the voice-over clip times from get_timeline first so '
      + 'each cue matches its audio. mode:"replace" rewrites the whole subtitle track '
      + "(ask the user before using it); default 'append'. The result returns lineBudget "
      + 'for the requested aspect_ratio plus overflows[] — shorten any cue that needs '
      + 'more than 3 lines and re-send, then verify with check_timeline (subtitle_overflow '
      + '/ subtitle_overlap / subtitle_style_drift). To change how long a subtitle '
      + 'stays on screen use resize_clip, not trim_clip.',
    parameters,

    execute: async (toolCallId: string, params: Params) => {
      const sourceIssue = sourceProblem(params);
      if (sourceIssue) return sourceIssue;
      const frame = resolveFrame(params);
      if (!frame.ok) return frame.rejection;
      const collected = await collectCues(context, toolCallId, params);
      if (!collected.ok) return collected.rejection;
      const cueIssue = cuesProblem(collected.cues);
      if (cueIssue) return cueIssue;
      const planned = planWrite(
        context, toolCallId, params, collected.cues, frame.frame);
      if (!planned.ok) return planned.rejection;
      const receipt = context.updateTimeline(toolCallId, planned.write.operation);
      if (!receipt.applied) {
        // 本地副本拒绝了同一操作：绝不报 success（P0-2 / V14）。
        return subtitleRejection('subtitle_apply_refused', {
          reason: receipt.reason, trackId: planned.write.trackId,
        });
      }
      const result = describeWrite(context, planned.write);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
