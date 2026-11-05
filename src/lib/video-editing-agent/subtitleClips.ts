/**
 * subtitleClips — agent 字幕的**唯一**纯函数层。
 *
 * 设计基线：docs/plans/agent-subtitles/spec.md §5#3 / §6.3 / §7.2（决策 D-3、
 * D-4、D-10、D-14、D-15、D-16）。
 *
 * 服务端本地副本（`agent.ts::applyOperationLocally`，同回合后续工具看到的那份）
 * 与浏览器真实时间线（`OperationApplier`）**只能**调这里的函数。项目历史上两次
 * 事故（F-AIEDIT-RV02 / RV-03）都是同一操作的两份实现漂移，代价是「模型说加上了、
 * 界面没有」。因此字段集合、upsert 语义、`isVisible`、颜色来源都在这里写死一次。
 *
 * 纯：无 React、DOM、Zustand；可在 Next.js API route 与浏览器同时加载。
 */

import type {
  AddSubtitleClipsOperation,
  AgentSubtitleClipData,
  AgentSubtitleCue,
  SubtitleStyle,
  TimelineItem,
  TimelineState,
  Track,
} from '@/types';
import { TrackTypeUtils } from '@/components/video/timeline/domain/value-objects/TrackType';
import { TRACK_HEIGHT } from '@/components/video/timeline/constants';
import { computeTimelineEnd } from './trackPatch';

/**
 * Agent 字幕的默认样式：与 `SubtitleEditModal` 的 `default` 预设**逐字段相同**
 * （D-3），所以「Agent 加的字幕」和「用户手点默认预设」外观一致。
 * 无 `backgroundColor` = 无背景。
 */
export const DEFAULT_AGENT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'default',
  fontSize: 60,
  fontColor: '#FFFFFF',
  position: 'bottom',
};

/**
 * 字幕条目颜色**只有一个来源**（D-16）：轨道类型的默认色。
 * 不要往 `OperationApplier` 的 `CLIP_COLORS` 里加 `subtitle`——那张表是
 * 「素材类型 → 颜色」，而字幕没有素材。
 */
export const SUBTITLE_CLIP_COLOR = TrackTypeUtils.getDefaultColor('subtitle');

/** 缺省字幕轨 id 前缀；无既有字幕轨时按 `subtitle-track-<n>` 顺延（§7.2）。 */
export const SUBTITLE_TRACK_ID_PREFIX = 'subtitle-track';

/** 首条字幕轨的 id：`resolveSubtitleTrackId` 在无冲突时的返回值。 */
export const SUBTITLE_TRACK_ID_FALLBACK = 'subtitle-track-1';

/** 单轨条目上限（D-17）：`append` 后超过它回 `subtitle_track_full`。 */
export const MAX_TRACK_CUES = 1000;

/** 时间窗比较精度；与 `tools/index.ts` 的 `POSITION_EPSILON` 同值。 */
const CUE_EPSILON = 1e-6;

/** 时间线轨上显示的名称长度（§7.2 `name`）。 */
const CLIP_NAME_CHARS = 20;

const SUBTITLE_FONT_SIZES = { min: 8, max: 72 } as const;

const SUBTITLE_FONT_FAMILIES: ReadonlyArray<SubtitleStyle['fontFamily']> = [
  'default', 'serif', 'sans-serif', 'monospace',
];

const SUBTITLE_POSITIONS: ReadonlyArray<SubtitleStyle['position']> = [
  'top', 'center', 'bottom', 'upper-3/4', 'lower-3/4',
];

/** `#RGB` / `#RRGGBB`（与人工 UI 的取色器同口径）。 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** 工具 schema 的 `style` 入参：字段全可选，缺省取默认预设。 */
export interface SubtitleStyleInput {
  fontFamily?: string;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  position?: string;
}

function isHexColor(value: unknown): boolean {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/**
 * `style` 的结构问题（V9）；`null` 表示合法。
 *
 * 只校验**给了**的字段：缺省字段由 `normalizeSubtitleStyle` 补默认值，所以
 * `{}` 与省略 `style` 等价，模型不需要背默认样式。
 */
export function subtitleStyleProblem(raw?: SubtitleStyleInput): string | null {
  if (!raw) return null;
  const { fontSize, fontFamily, position } = raw;
  if (fontSize !== undefined && !(
    Number.isFinite(fontSize)
    && fontSize >= SUBTITLE_FONT_SIZES.min
    && fontSize <= SUBTITLE_FONT_SIZES.max
  )) {
    return `style.fontSize must be ${SUBTITLE_FONT_SIZES.min}..${SUBTITLE_FONT_SIZES.max}`;
  }
  if (fontFamily !== undefined && !SUBTITLE_FONT_FAMILIES.includes(
    fontFamily as SubtitleStyle['fontFamily'],
  )) {
    return `style.fontFamily must be one of ${SUBTITLE_FONT_FAMILIES.join(', ')}`;
  }
  if (position !== undefined && !SUBTITLE_POSITIONS.includes(
    position as SubtitleStyle['position'],
  )) {
    return `style.position must be one of ${SUBTITLE_POSITIONS.join(', ')}`;
  }
  if (raw.fontColor !== undefined && !isHexColor(raw.fontColor)) {
    return 'style.fontColor must be a hex colour such as #FFFFFF';
  }
  if (raw.backgroundColor !== undefined && !isHexColor(raw.backgroundColor)) {
    return 'style.backgroundColor must be a hex colour such as #000000';
  }
  return null;
}

/**
 * 补齐默认值的样式（D-3）。调用前必须已过 `subtitleStyleProblem`——本函数
 * 信任入参，不做第二次校验（边界校验只做一次）。
 */
export function normalizeSubtitleStyle(
  raw?: SubtitleStyleInput,
): SubtitleStyle {
  const style: SubtitleStyle = {
    fontFamily: (raw?.fontFamily as SubtitleStyle['fontFamily'])
      ?? DEFAULT_AGENT_SUBTITLE_STYLE.fontFamily,
    fontSize: raw?.fontSize ?? DEFAULT_AGENT_SUBTITLE_STYLE.fontSize,
    fontColor: raw?.fontColor ?? DEFAULT_AGENT_SUBTITLE_STYLE.fontColor,
    position: (raw?.position as SubtitleStyle['position'])
      ?? DEFAULT_AGENT_SUBTITLE_STYLE.position,
  };
  if (raw?.backgroundColor !== undefined) {
    style.backgroundColor = raw.backgroundColor;
  }
  return style;
}

/** 首个字幕轨（D-RK3）：缺省目标轨，模型不必知道轨 id。 */
export function resolveSubtitleTrack(
  state: TimelineState,
): Track | undefined {
  return state.tracks.find(track => track.type === 'subtitle');
}

/**
 * 本次写入要用的字幕轨 id。
 *
 * 显式 `preferred` 优先（工具已校验它的存在性与类型）；否则复用首个字幕轨；
 * 都没有时按 `trackActions.addTrack` 的规则顺延 `subtitle-track-<n>`（§7.2），
 * 保证两端拿到**同一个** id —— 建轨只发生在纯函数里，id 必须先定下来。
 */
export function resolveSubtitleTrackId(
  state: TimelineState,
  preferred?: string,
): string {
  if (preferred) return preferred;
  const existing = resolveSubtitleTrack(state);
  if (existing) return existing.id;
  const taken = new Set(state.tracks.map(track => track.id));
  if (!taken.has(SUBTITLE_TRACK_ID_FALLBACK)) {
    return SUBTITLE_TRACK_ID_FALLBACK;
  }
  let suffix = 1;
  while (taken.has(`${SUBTITLE_TRACK_ID_PREFIX}-${suffix}`)) suffix += 1;
  return `${SUBTITLE_TRACK_ID_PREFIX}-${suffix}`;
}

/** 时间线轨上显示的名称：文本前 20 字（§7.2）。 */
export function subtitleClipName(text: string): string {
  return Array.from(text.trim()).slice(0, CLIP_NAME_CHARS).join('');
}

interface TimeWindow {
  startTime: number;
  duration: number;
}

/** 时间窗是否真的相交；ε 以内的贴合（首尾相接）不算重叠。 */
function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  const start = Math.max(a.startTime, b.startTime);
  const end = Math.min(
    a.startTime + a.duration,
    b.startTime + b.duration,
  );
  return end - start > CUE_EPSILON;
}

/** 一次冲突的定位信息；字段名与 spec §6.1 的错误载荷一致。 */
export interface CueConflict {
  /** 批内第几条（0 基，与 `cues[index]` 对应）。 */
  index: number;
  text: string;
  startTime: number;
  duration: number;
  /** 与**同批前一条**冲突时的下标记（0 基）。 */
  previousIndex?: number;
  /** 与**目标轨既有条目**冲突时它在轨内的下标（0 基）。 */
  existingIndex?: number;
  existingText?: string;
  overlapStart?: number;
  overlapEnd?: number;
}

function conflictWindow(a: TimeWindow, b: TimeWindow) {
  return {
    overlapStart: Math.max(a.startTime, b.startTime),
    overlapEnd: Math.min(
      a.startTime + a.duration,
      b.startTime + b.duration,
    ),
  };
}

/**
 * 第一个冲突的 cue；`null` 表示整批干净。
 *
 * `existing` 传目标轨的既有条目（`append` 时才需要，`replace` 传空数组），
 * `cues` 传**已按 startTime 排序**的批内条目。检查顺序：先批内（模型能自己
 * 改时间），再与既有条目（要动用户的东西，值得单独一条错误码）。
 */
export function findCueConflicts(
  existing: readonly TimelineItem[],
  cues: readonly AgentSubtitleCue[],
): CueConflict | null {
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    for (let previous = 0; previous < index; previous += 1) {
      if (!overlaps(cues[previous], cue)) continue;
      return {
        index,
        text: cue.text,
        startTime: cue.startTime,
        duration: cue.duration,
        previousIndex: previous,
        ...conflictWindow(cues[previous], cue),
      };
    }
  }
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    for (let slot = 0; slot < existing.length; slot += 1) {
      const item = existing[slot];
      if (!overlaps(item, cue)) continue;
      return {
        index,
        text: cue.text,
        startTime: cue.startTime,
        duration: cue.duration,
        existingIndex: slot,
        existingText: item.text ?? item.name,
        ...conflictWindow(item, cue),
      };
    }
  }
  return null;
}

/** 建轨（两端同一份）：`isVisible` 必须为 true，否则预览整轨消失（D-14）。 */
function ensureSubtitleTrack(
  state: TimelineState,
  operation: AddSubtitleClipsOperation,
): Track {
  const existing = state.tracks.find(tr => tr.id === operation.trackId);
  if (existing) return existing;
  const track: Track = {
    id: operation.trackId,
    name: operation.trackName ?? '',
    type: 'subtitle',
    height: TRACK_HEIGHT.subtitle,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    volume: 100,
    order: state.tracks.length,
    items: [],
  };
  state.tracks.push(track);
  return track;
}

/**
 * 写入一条 cue：同 `id` 原地覆盖，否则追加（D-15）。
 *
 * 覆盖而不是 push 是幂等的前提：SSE 重放 / 同 turn 重试会把**同一个**操作再落
 * 一次，无脑 push 会得到两条同 id 的字幕（React key 冲突、假补丁、双层字幕）。
 */
function upsertSubtitleItem(
  track: Track,
  operation: AddSubtitleClipsOperation,
  clip: AgentSubtitleClipData,
): void {
  const fields = {
    name: clip.name,
    text: clip.text,
    startTime: clip.startTime,
    duration: clip.duration,
    subtitleStyle: operation.style,
  };
  const existing = track.items.find(item => item.id === clip.id);
  if (existing) {
    Object.assign(existing, fields);
    return;
  }
  // 字段集合见 spec §7.2：不写 materialId / url / originalDuration——字幕没有
  // 素材，`isClipMaterialMissing` 对 type==='subtitle' 直接返回 false。
  track.items.push({
    id: clip.id,
    type: 'subtitle',
    trackId: track.id,
    color: SUBTITLE_CLIP_COLOR,
    volume: 1,
    opacity: 1,
    ...fields,
  });
}

/**
 * 把 `add_subtitle_clips` 落到一份时间线状态上（§6.3，唯一实现）。
 *
 * 顺序：找/建轨 → `replace` 先清空 → 逐条 upsert → 按 startTime 稳定排序 →
 * 重算 `totalDuration`。`totalDuration` 放在这里（而不是各调用方）是 P0-2 的
 * 第二条机制：浏览器侧一直有这一步，服务端副本以前漏了，同回合后续的
 * `get_timeline` 因此看到两份不同的时长。
 */
export function applySubtitleClipsToState(
  state: TimelineState,
  operation: AddSubtitleClipsOperation,
): void {
  const track = ensureSubtitleTrack(state, operation);
  if (operation.mode === 'replace') track.items = [];
  for (const clip of operation.clips) {
    upsertSubtitleItem(track, operation, clip);
  }
  track.items.sort((left, right) => left.startTime - right.startTime);
  state.totalDuration = computeTimelineEnd(state);
}
