/**
 * qualityLint.ts — `check_timeline` 的纯规则引擎（16 条）。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §4.10（规则表）、§3.3
 * （为什么放在前端纯函数里）。
 *
 * 三条纪律：
 *  1. **纯函数**：不读设置、不发网络、不 async（AC-05 / AC-30）。所有阈值只能
 *     来自本文件的常量（R-19：阈值只放在执行点所在层，否则用户调了却不生效）。
 *  2. **不造第二份真相**：字幕折行复用 `subtitleLayout`，同轨重叠复用
 *     `ItemPlacementService.findAllOverlaps`（与 `check_timeline_overlaps` 同源），
 *     素材索引与轨道时长复用 `tools/index` 的既有纯函数。
 *  3. **不许假绿**：任何 blocker 存在即 `ok:false`；空时间线必须报
 *     `timeline_empty`（AC-27 / R-17），否则其余 14 条会"全部通过"。
 */

import type { MaterialItem, TimelineItem, TimelineState, Track } from '@/types';
import type {
  TimelineLintIssue, TimelineLintReport, TimelineLintTarget, VisionSeverity,
} from '@/types/agentVision';
import {
  SUBTITLE_MARGIN_PX, maxSubtitleChars, outputSizeForAspect, wrapSubtitleText,
} from '@/components/video/lib/subtitleLayout';
import { ItemPlacementService } from '@/components/video/timeline/domain/services/ItemPlacementService';
import {
  collectTimelineWebMaterials, isLicenseDeclared,
} from './webMaterialProvenance';
import {
  findMaterial, getTrackEndTime, getVideoTrackMaxDuration, isStillClip,
} from './index';

/** 规则阈值（§4.10）。**这里就是**唯一来源，不读后端 YAML、不读设置。 */
export const LINT_DEFAULTS = {
  maxIssues: 20,
  subtitleMaxLines: 3,
  gapSeconds: 0.5,
  overlapEpsilon: 1e-6, // 与 tools/index.ts 的 POSITION_EPSILON 同值
  durationTolerance: 0.05,
} as const;

/** 16 条规则，顺序即 §4.10 的表格顺序（`checked_rules` 原样回显）。 */
export const LINT_RULE_CODES = [
  'missing_material',
  'clip_bounds',
  'item_overlap',
  'subtitle_overflow',
  'subtitle_overlap',
  'subtitle_style_drift',
  'track_hidden',
  'audio_gap',
  'volume_out_of_range',
  'upscale_blur',
  'static_image_too_long',
  'timeline_gap',
  'cover_not_applied',
  'duration_mismatch',
  'timeline_empty',
  'web_material_license_unknown',
] as const;

export type LintRuleCode = (typeof LINT_RULE_CODES)[number];

export type LintAspectRatio = '16:9' | '9:16' | '4:3' | '1:1' | '21:9';

/** `aspect_ratio` 参数的可选值（工具 schema 与测试共用一份）。 */
export const LINT_ASPECT_RATIOS: readonly LintAspectRatio[] = [
  '16:9', '9:16', '4:3', '1:1', '21:9',
];

/** 目标分辨率：导出宽高，字幕折行与放大模糊都按它判定。 */
export function defaultTargetResolution(
  aspectRatio: LintAspectRatio,
): { width: number; height: number } {
  // 直接问导出侧那张表（`subtitleLayout.OUTPUT_SIZE_BY_ASPECT`）：自检判的是
  // "这片子在成片里糊不糊 / 字幕会不会溢出"，基准分辨率必须是导出真正会用
  // 的那一个。第二份手写表迟早与它漂移（21:9 就差了 40px）。
  const size = outputSizeForAspect(aspectRatio);
  return { width: size.width, height: size.height };
}

/** 报告排序权重：blocker 先，note 后。 */
const SEVERITY_ORDER: Readonly<Record<VisionSeverity, number>> =
  { blocker: 0, warning: 1, note: 2 };

/** 缺省字幕字号（§4.10 规则 6：缺 style 时导出按 24px 处理）。 */
const DEFAULT_SUBTITLE_FONT_SIZE = 24;
/** §4.10 规则 8：视频时长内连续无音频超过这个秒数就是"静音空洞"。 */
const AUDIO_GAP_SECONDS = 2;
/** §4.10 规则 9：track.volume 是 0–200（100 = 原声），>150 会削波。 */
const TRACK_VOLUME_CLIP_LIMIT = 150;
/** §4.10 规则 10：低于目标宽度 75% 的素材放大后肉眼可见模糊。 */
const UPSCALE_WIDTH_RATIO = 0.75;
/** §4.10 规则 11：静图停留超过 8 秒且无运镜就像卡帧。 */
const STATIC_IMAGE_MAX_SECONDS = 8;

/** 收集器：规则函数只往里追加，不在彼此之间传状态。 */
interface LintScope {
  state: TimelineState;
  materials: MaterialItem[];
  targetWidth: number;
  targetHeight: number;
  issues: TimelineLintIssue[];
}

interface PlacedItem {
  track: Track;
  item: TimelineItem;
  /** 该 item 在轨道内的序号（从 0 开始），用于 `subtitle #3` 这类定位。 */
  index: number;
}

function push(
  scope: LintScope,
  code: LintRuleCode,
  severity: VisionSeverity,
  message: string,
  target?: TimelineLintTarget,
  suggestedTool: string | null = null,
): void {
  scope.issues.push({
    code,
    severity,
    message,
    ...(target ? { target } : {}),
    suggested_tool: suggestedTool,
  });
}

/** 展平轨道上的 item（可按 item 类型过滤），保留所在轨道与轨道内序号。 */
function placedItems(
  tracks: readonly Track[],
  type?: TimelineItem['type'],
): PlacedItem[] {
  const placed: PlacedItem[] = [];
  for (const track of tracks) {
    track.items.forEach((item, index) => {
      if (type && item.type !== type) return;
      placed.push({ track, item, index });
    });
  }
  return placed;
}

function tracksOfType(state: TimelineState, types: readonly Track['type'][]) {
  return state.tracks.filter(track => types.includes(track.type));
}

/** 视频轨上的 item 既可能是视频也可能是图片（图片以 `type:'video'` 上轨）。 */
function pictureTracks(state: TimelineState): Track[] {
  return tracksOfType(state, ['video']);
}

function seconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

// --- 规则 1：missing_material ---------------------------------------------

/**
 * 视频 item 指向的素材已不在库里、且没有任何 URL 快照 → 导出前 pre-flight 必
 * 失败（blocker）。音频/图片只是被丢弃或跳过（§4.10 的 v2 更正），降为 warning。
 */
function lintMissingMaterial(scope: LintScope): void {
  const tracks = scope.state.tracks.filter(track => track.type !== 'subtitle');
  for (const { track, item } of placedItems(tracks)) {
    if (!item.materialId) continue;
    if (findMaterial(scope.materials, item.materialId)) continue;
    if (item.url || item.cacheUrl || item.storageKey) continue;
    const isPictureAsset = item.type === 'video' && !isStillClip(item, scope.materials);
    push(
      scope, 'missing_material', isPictureAsset ? 'blocker' : 'warning',
      `clip "${item.name}" on track ${track.id} points at material `
        + `${item.materialId}, which is not in the library and has no `
        + 'url/cacheUrl/storageKey fallback.',
      { trackId: track.id, itemId: item.id }, 'list_materials',
    );
  }
}

// --- 规则 2：clip_bounds ---------------------------------------------------

/** 单个 item 的越界原因；合法时返回 null。 */
function clipBoundsProblem(item: TimelineItem, scope: LintScope): string | null {
  if (item.startTime < 0) {
    return `starts at ${seconds(item.startTime)}; a clip cannot start before 0`;
  }
  if (!(item.duration > 0)) {
    return `has duration ${seconds(item.duration)}; a clip needs a positive duration`;
  }
  // 图片 item 按设计保留 clipStart=clipEnd=0（白名单），只查视频/音频的源区间。
  if (isStillClip(item, scope.materials)) return null;
  const { clipStart, clipEnd } = item;
  if (typeof clipStart === 'number' && typeof clipEnd === 'number'
    && clipEnd - clipStart <= LINT_DEFAULTS.overlapEpsilon) {
    return `selects source range ${seconds(clipStart)}–${seconds(clipEnd)}, `
      + 'which is empty';
  }
  return null;
}

function lintClipBounds(scope: LintScope): void {
  for (const { track, item } of placedItems(scope.state.tracks)) {
    const problem = clipBoundsProblem(item, scope);
    if (!problem) continue;
    push(scope, 'clip_bounds', 'blocker',
      `clip "${item.name}" on track ${track.id} ${problem}.`,
      { trackId: track.id, itemId: item.id }, 'trim_clip');
  }
}

// --- 规则 3 / 5：item_overlap 与 subtitle_overlap --------------------------

/**
 * 同轨重叠，复用 `check_timeline_overlaps` 的算法（半开区间 + epsilon），
 * 不重写第二份实现。
 */
function lintTrackOverlaps(
  scope: LintScope,
  tracks: readonly Track[],
  code: LintRuleCode,
  severity: VisionSeverity,
  suggestedTool: string | null,
): void {
  const reports = ItemPlacementService.findAllOverlaps(tracks,
    { epsilon: LINT_DEFAULTS.overlapEpsilon });
  for (const report of reports) {
    const overlap = report.overlapEnd - report.overlapStart;
    push(scope, code, severity,
      `clips "${report.a.clipId}" and "${report.b.clipId}" overlap by `
        + `${seconds(overlap)} on track ${report.trackId} `
        + `(${seconds(report.overlapStart)}–${seconds(report.overlapEnd)}).`,
      {
        trackId: report.trackId,
        itemId: report.b.clipId,
        at_seconds: Number(report.overlapStart.toFixed(2)),
      },
      suggestedTool);
  }
}

// --- 规则 4：subtitle_overflow --------------------------------------------

function lintSubtitleOverflow(scope: LintScope): void {
  for (const { track, item, index } of placedItems(
    tracksOfType(scope.state, ['subtitle']), 'subtitle',
  )) {
    const text = (item.text ?? '').trim();
    if (!text) continue;
    const fontSize = item.subtitleStyle?.fontSize ?? DEFAULT_SUBTITLE_FONT_SIZE;
    const limit = maxSubtitleChars(scope.targetWidth, fontSize);
    const lines = wrapSubtitleText(text, limit);
    const longest = lines.reduce(
      (max, line) => Math.max(max, Array.from(line).length), 0);
    const tooManyLines = lines.length > LINT_DEFAULTS.subtitleMaxLines;
    const tooLongLine = longest > limit;
    if (!tooManyLines && !tooLongLine) continue;
    push(scope, 'subtitle_overflow', 'warning',
      `subtitle #${index + 1} on track ${track.id} needs ${lines.length} lines `
        + `(longest ${longest} chars, ${Array.from(text).length} chars of text); `
        + `the limit is ${LINT_DEFAULTS.subtitleMaxLines} lines of ${limit} chars `
        + `at font size ${fontSize} on a ${scope.targetWidth}px frame.`,
      { trackId: track.id, itemId: item.id, at_seconds: item.startTime });
  }
}

// --- 规则 6：subtitle_style_drift ----------------------------------------

function lintSubtitleStyleDrift(scope: LintScope): void {
  for (const { track, item, index } of placedItems(
    tracksOfType(scope.state, ['subtitle']), 'subtitle',
  )) {
    if (item.subtitleStyle) continue;
    push(scope, 'subtitle_style_drift', 'note',
      `subtitle #${index + 1} on track ${track.id} has no subtitleStyle; preview `
        + `and export both fall back to ${DEFAULT_SUBTITLE_FONT_SIZE}px with a `
        + `${SUBTITLE_MARGIN_PX}px bottom margin.`,
      { trackId: track.id, itemId: item.id, at_seconds: item.startTime });
  }
}

// --- 规则 7：track_hidden -------------------------------------------------

/** 有 item 却被关掉的轨道：导出会整轨消失（CompositionAdapter 只看可见性）。 */
function lintHiddenTracks(scope: LintScope): void {
  for (const track of scope.state.tracks) {
    if (track.items.length === 0) continue;
    const isAudio = track.type === 'audio';
    // 导出侧对音频轨的过滤是 `!isVisible || isMuted`（CompositionAdapter
    // extractAudioTracks），所以"没静音但被隐藏"的音频轨同样整轨消失。
    const hidden = isAudio
      ? track.isMuted || !track.isVisible
      : !track.isVisible;
    if (!hidden) continue;
    push(scope, 'track_hidden', 'blocker',
      `track ${track.id} (${track.type}) holds ${track.items.length} clip(s) but is `
        + `${isAudio ? 'muted or hidden' : 'hidden'}; the export drops the whole track.`,
      { trackId: track.id });
  }
}

// --- 规则 8：audio_gap ---------------------------------------------------

/** 把有声音的音频区间合并后，求视频时长内 > AUDIO_GAP_SECONDS 的空洞。 */
function uncoveredSpans(
  items: readonly TimelineItem[], videoEnd: number,
): Array<{ start: number; end: number }> {
  const merged: Array<{ start: number; end: number }> = [];
  const bounds = items
    .map(item => ({ start: item.startTime, end: item.startTime + item.duration }))
    .sort((a, b) => a.start - b.start);
  for (const span of bounds) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      continue;
    }
    merged.push({ ...span });
  }
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start - cursor > AUDIO_GAP_SECONDS) {
      gaps.push({ start: cursor, end: span.start });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (videoEnd - cursor > AUDIO_GAP_SECONDS) gaps.push({ start: cursor, end: videoEnd });
  return gaps;
}

function lintAudioGaps(scope: LintScope): void {
  const audioTracks = tracksOfType(scope.state, ['audio']);
  const audio = placedItems(audioTracks, 'audio')
    .filter(({ item }) => (item.volume ?? 1) > 0);
  const videoEnd = getVideoTrackMaxDuration(scope.state);
  if (audioTracks.length > 0 && placedItems(audioTracks, 'audio').length > 0
    && audio.length === 0) {
    push(scope, 'audio_gap', 'warning',
      'every audio clip on the timeline has volume 0, so the video plays silent.',
      undefined, 'generate_tts');
    return;
  }
  if (!(videoEnd > 0)) return;
  const audioEnd = Math.max(0, ...audioTracks.map(getTrackEndTime));
  for (const gap of uncoveredSpans(audio.map(({ item }) => item), videoEnd)) {
    push(scope, 'audio_gap', 'warning',
      `no audio between ${seconds(gap.start)} and ${seconds(gap.end)} `
        + `(${seconds(gap.end - gap.start)} uncovered) of the ${seconds(videoEnd)} `
        + `video; audio tracks end at ${seconds(audioEnd)}.`,
      { at_seconds: Number(gap.start.toFixed(2)) }, 'generate_tts');
  }
}

// --- 规则 9：volume_out_of_range -----------------------------------------

function lintVolumes(scope: LintScope): void {
  for (const track of scope.state.tracks) {
    if (!(track.volume > TRACK_VOLUME_CLIP_LIMIT)) continue;
    push(scope, 'volume_out_of_range', 'warning',
      `track ${track.id} volume is ${track.volume} on a 0–200 scale; above `
        + `${TRACK_VOLUME_CLIP_LIMIT} the mix clips.`,
      { trackId: track.id });
  }
  for (const { track, item } of placedItems(scope.state.tracks)) {
    if (typeof item.volume !== 'number' || item.volume <= 1) continue;
    push(scope, 'volume_out_of_range', 'warning',
      `clip "${item.name}" volume is ${item.volume}; clip volume is 0–1, so `
        + 'anything above 1 clips.',
      { trackId: track.id, itemId: item.id });
  }
}

// --- 规则 10：upscale_blur -----------------------------------------------

function lintUpscale(scope: LintScope): void {
  const threshold = scope.targetWidth * UPSCALE_WIDTH_RATIO;
  for (const { track, item } of placedItems(pictureTracks(scope.state))) {
    if (!item.materialId) continue;
    const material = findMaterial(scope.materials, item.materialId);
    if (!material?.width || material.width >= threshold) continue;
    push(scope, 'upscale_blur', 'note',
      `material "${material.name}" is ${material.width}px wide; the `
        + `${scope.targetWidth}px target upscales it `
        + `${(scope.targetWidth / material.width).toFixed(2)}x `
        + `(needs ${Math.round(threshold)}px to stay sharp).`,
      { trackId: track.id, itemId: item.id });
  }
}

// --- 规则 11：static_image_too_long --------------------------------------
// 运镜只有 UI 通路（CameraMotionModal / store.setCameraMotion），没有 set_camera_motion
// 工具（§4.10 的 P1-8 更正）；Agent 能做的是 image_to_video：把静图换成带推拉/平移的视频镜头。
function lintStaticImages(scope: LintScope): void {
  for (const { track, item } of placedItems(pictureTracks(scope.state))) {
    if (item.duration <= STATIC_IMAGE_MAX_SECONDS || item.cameraMotion) continue;
    if (!isStillClip(item, scope.materials)) continue;
    push(scope, 'static_image_too_long', 'note',
      `still image "${item.name}" holds ${seconds(item.duration)} without camera `
        + `motion; past ${STATIC_IMAGE_MAX_SECONDS}s it reads as a frozen frame. `
        + 'Replace it with a video clip: image_to_video on the source image '
        + '(slow push or pan), or keep it only if it is a deliberate overlay.',
      { trackId: track.id, itemId: item.id, at_seconds: item.startTime },
      'image_to_video');
  }
}

// --- 规则 12：timeline_gap ----------------------------------------------

function lintTimelineGaps(scope: LintScope): void {
  for (const track of pictureTracks(scope.state)) {
    const items = [...track.items].sort((a, b) => a.startTime - b.startTime);
    let cursor: number | null = null;
    for (const item of items) {
      if (cursor !== null && item.startTime - cursor > LINT_DEFAULTS.gapSeconds) {
        push(scope, 'timeline_gap', 'note',
          `track ${track.id} has a ${seconds(item.startTime - cursor)} hole between `
            + `${seconds(cursor)} and ${seconds(item.startTime)}; nothing is drawn `
            + 'there, so the frame goes black.',
          { trackId: track.id, itemId: item.id, at_seconds: Number(cursor.toFixed(2)) },
          'move_clip');
      }
      cursor = Math.max(cursor ?? 0, item.startTime + item.duration);
    }
  }
}

// --- 规则 13：cover_not_applied -----------------------------------------

function lintCover(scope: LintScope): void {
  // `coverSchemaVersion` 是项目内容（VideoEditingTaskContent）上的单调标记；
  // 时间线快照可能带着它，缺省即"这个项目还没有封面"。
  const flagged = (scope.state as TimelineState & { coverSchemaVersion?: 2 })
    .coverSchemaVersion === 2;
  if (!flagged) return;
  const applied = scope.state.tracks.some(track => track.items
    .some(item => item.metadata?.role === 'video-cover'));
  if (applied) return;
  push(scope, 'cover_not_applied', 'note',
    'the project already has a cover (coverSchemaVersion 2) but no clip on the '
      + 'timeline carries metadata.role "video-cover", so the export has no cover '
      + 'segment.',
    undefined, 'apply_video_cover');
}

// --- 规则 16：web_material_license_unknown -----------------------------

/** 详情里最多列出几个素材名。 */
const LICENSE_RULE_NAME_LIMIT = 5;

function lintWebMaterialLicense(scope: LintScope): void {
  const unlicensed = collectTimelineWebMaterials(scope.state, scope.materials)
    .filter(entry => !isLicenseDeclared(entry.provenance));
  if (unlicensed.length === 0) return;
  const names = unlicensed.slice(0, LICENSE_RULE_NAME_LIMIT).map(entry => entry.name);
  const rest = unlicensed.length - names.length;
  push(scope, 'web_material_license_unknown', 'warning',
    `${unlicensed.length} web material(s) on the timeline have no declared licence: `
      + `${names.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}. The source page `
      + 'stated no licence, which is not permission to use it commercially; tell '
      + 'the user, and run build_credits for a source list.',
    undefined, 'build_credits');
}

// --- 规则 14：duration_mismatch -----------------------------------------

function lintDurationMismatch(scope: LintScope): void {
  const videoEnd = getVideoTrackMaxDuration(scope.state);
  if (!(videoEnd > 0)) return;
  const total = scope.state.totalDuration;
  const drift = Math.abs(total - videoEnd);
  if (drift <= LINT_DEFAULTS.durationTolerance) return;
  push(scope, 'duration_mismatch', 'warning',
    `totalDuration is ${seconds(total)} but the video tracks end at `
      + `${seconds(videoEnd)}, a ${seconds(drift)} difference (tolerance `
      + `${LINT_DEFAULTS.durationTolerance}s).`,
    { at_seconds: Number(Math.min(total, videoEnd).toFixed(2)) });
}

// --- 规则 15：timeline_empty --------------------------------------------

function lintEmpty(scope: LintScope): void {
  const pictures = placedItems(pictureTracks(scope.state));
  if (pictures.length === 0) {
    push(scope, 'timeline_empty', 'blocker',
      `the timeline has no clip on any video track (${scope.state.tracks.length} `
        + `track(s), ${seconds(scope.state.totalDuration)} total), so there is `
        + 'nothing to export.',
      undefined, 'add_to_track');
    return;
  }
  if (!(scope.state.totalDuration > 0)) {
    push(scope, 'timeline_empty', 'blocker',
      `totalDuration is ${seconds(scope.state.totalDuration)} although `
        + `${pictures.length} video clip(s) exist; the export would be empty.`,
      undefined, 'add_to_track');
  }
}

// --- 报告组装 ------------------------------------------------------------

interface SeverityCounts {
  blocker: number;
  warning: number;
  note: number;
}

function countSeverities(issues: readonly TimelineLintIssue[]): SeverityCounts {
  const counts: SeverityCounts = { blocker: 0, warning: 0, note: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

/** 一句话下一步：先 blockers，再 warnings，最后才是可选修饰。 */
function nextStep(
  counts: SeverityCounts,
  shown: readonly TimelineLintIssue[],
  includeNotes: boolean,
): string {
  const fixable = shown.find(issue => issue.suggested_tool);
  const handle = fixable
    ? ` Start with ${fixable.code} via ${fixable.suggested_tool}.` : '';
  if (counts.blocker > 0) {
    return `Fix the ${counts.blocker} blocker(s) before exporting.${handle}`;
  }
  if (counts.warning > 0) {
    return `Fix the ${counts.warning} warning(s), then run check_timeline again.${handle}`;
  }
  if (counts.note > 0 && !includeNotes) {
    return `Nothing blocks the export; call check_timeline with include_notes=true `
      + `to see the ${counts.note} optional note(s).`;
  }
  if (counts.note > 0) {
    return `Nothing blocks the export; the ${counts.note} note(s) are optional `
      + 'polish.';
  }
  return 'All 16 checks passed; export when the user is ready.';
}

function assembleReport(
  issues: readonly TimelineLintIssue[],
  includeNotes: boolean,
): TimelineLintReport {
  const counts = countSeverities(issues);
  const listed = includeNotes
    ? [...issues]
    : issues.filter(issue => issue.severity !== 'note');
  const sorted = listed.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const shown = sorted.slice(0, LINT_DEFAULTS.maxIssues);
  const truncated = sorted.length - shown.length;
  return {
    ok: counts.blocker === 0,
    blockers: counts.blocker,
    warnings: counts.warning,
    notes: counts.note,
    issues: shown,
    checked_rules: [...LINT_RULE_CODES],
    ...(truncated > 0 ? { truncated } : {}),
    next_step: nextStep(counts, shown, includeNotes),
  };
}

/**
 * 跑完 16 条规则并组装报告。纯函数：同样的输入永远得到同样的输出。
 *
 * `includeNotes` 默认 false（§5.3）：默认只把 blocker + warning 塞进上下文，
 * 但 `notes` 计数仍如实返回，`next_step` 会说明还有几条没展开。
 */
export function lintTimeline(input: {
  timelineState: TimelineState;
  materials: MaterialItem[];
  targetWidth: number;
  targetHeight: number;
  includeNotes?: boolean;
}): TimelineLintReport {
  const scope: LintScope = {
    state: input.timelineState,
    materials: input.materials,
    targetWidth: input.targetWidth,
    targetHeight: input.targetHeight,
    issues: [],
  };
  // 顺序即 §4.10 的表格顺序；规则之间互不读取彼此的 issue。
  lintEmpty(scope);
  lintMissingMaterial(scope);
  lintClipBounds(scope);
  lintTrackOverlaps(scope, tracksOfType(scope.state, ['video', 'audio']),
    'item_overlap', 'warning', 'auto_fix_overlaps');
  lintSubtitleOverflow(scope);
  lintTrackOverlaps(scope, tracksOfType(scope.state, ['subtitle']),
    'subtitle_overlap', 'warning', 'move_clip');
  lintSubtitleStyleDrift(scope);
  lintHiddenTracks(scope);
  lintAudioGaps(scope);
  lintVolumes(scope);
  lintUpscale(scope);
  lintStaticImages(scope);
  lintTimelineGaps(scope);
  lintCover(scope);
  lintDurationMismatch(scope);
  lintWebMaterialLicense(scope);
  return assembleReport(scope.issues, input.includeNotes === true);
}
