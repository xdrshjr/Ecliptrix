/**
 * operationGuards — validate an agent timeline operation against the state it
 * is about to change, before anything is mutated.
 *
 * Shared by the browser `OperationApplier` and the server-side
 * `agent.ts::applyOperationLocally`, so both refuse the same operations:
 * a move to a track that does not exist no longer deletes the clip, a clip
 * that is already gone no longer reports success, and a negative or
 * non-finite time never reaches the timeline domain (where it throws inside a
 * React effect).
 *
 * Pure: no React, DOM or store access.
 */

import type {
  AddSubtitleClipsOperation,
  AgentTimelineOperation,
  OperationRejectReason,
  TimelineState,
  Track,
} from '@/types';
import type { TimelineOperation } from './types';
import { subtitleStyleProblem } from './subtitleClips';

export type { OperationRejectReason } from '@/types';

export type OperationValidation =
  | { ok: true }
  | { ok: false; reason: OperationRejectReason; trackId?: string; clipId?: string };

type GuardedOperation = AgentTimelineOperation | TimelineOperation;
type AddClip = Extract<GuardedOperation, { type: 'add_clip' }>;
type MoveClip = Extract<GuardedOperation, { type: 'move_clip' }>;
type TrimClip = Extract<GuardedOperation, { type: 'trim_clip' }>;
type ResizeClip = Extract<GuardedOperation, { type: 'resize_clip' }>;

const VALID: OperationValidation = { ok: true };

/**
 * 字幕批内重叠判定精度：与 `tools/index.ts` 的 `POSITION_EPSILON` 同值。
 *
 * 刻意不 import 那个常量：`tools/index` 会把**每一个工具**拉进模块图，而本模块
 * 运行在浏览器里（`OperationApplier` 的守卫）。与 `qualityLint.LINT_DEFAULTS`
 * 里 `overlapEpsilon` 的处理方式一致。
 */
const OVERLAP_EPSILON = 1e-6;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeTime(value: unknown): boolean {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveDuration(value: unknown): boolean {
  return isFiniteNumber(value) && value > 0;
}

function findTrack(state: TimelineState, trackId: string): Track | undefined {
  return state.tracks.find(track => track.id === trackId);
}

function trackHoldingClip(state: TimelineState, clipId: string): Track | undefined {
  return state.tracks.find(track => track.items.some(item => item.id === clipId));
}

function invalidTime(clipId?: string): OperationValidation {
  return { ok: false, reason: 'invalid-time', clipId };
}

/**
 * The target track may be missing: the applier creates it, mirroring the
 * track the server-side tool auto-created for this clip.
 */
function validateAddClip({ clip }: AddClip): OperationValidation {
  const timesValid =
    isNonNegativeTime(clip.startTime) &&
    isPositiveDuration(clip.duration) &&
    isNonNegativeTime(clip.clipStart ?? 0);
  return timesValid ? VALID : invalidTime(clip.id);
}

function validateDelete(
  state: TimelineState,
  trackId: string,
  clipId: string,
): OperationValidation {
  const track = findTrack(state, trackId);
  if (!track) return { ok: false, reason: 'track-not-found', trackId, clipId };
  if (!track.items.some(item => item.id === clipId)) {
    return { ok: false, reason: 'clip-not-found', trackId, clipId };
  }
  return VALID;
}

/** Checked in full before the clip is taken off its source track. */
function validateMove(state: TimelineState, operation: MoveClip): OperationValidation {
  const { clipId, fromTrackId, toTrackId } = operation;
  const fromTrack = findTrack(state, fromTrackId);
  if (!fromTrack) {
    return { ok: false, reason: 'track-not-found', trackId: fromTrackId, clipId };
  }
  if (!fromTrack.items.some(item => item.id === clipId)) {
    return { ok: false, reason: 'clip-not-found', trackId: fromTrackId, clipId };
  }
  if (!findTrack(state, toTrackId)) {
    return { ok: false, reason: 'target-track-missing', trackId: toTrackId, clipId };
  }
  return isNonNegativeTime(operation.newStartTime) ? VALID : invalidTime(clipId);
}

function validateTrim(state: TimelineState, operation: TrimClip): OperationValidation {
  const { clipId } = operation;
  if (!trackHoldingClip(state, clipId)) return { ok: false, reason: 'clip-not-found', clipId };
  const rangeValid =
    isNonNegativeTime(operation.clipStart) &&
    isFiniteNumber(operation.clipEnd) &&
    operation.clipEnd > operation.clipStart &&
    isPositiveDuration(operation.duration);
  return rangeValid ? VALID : invalidTime(clipId);
}

function validateResize(state: TimelineState, operation: ResizeClip): OperationValidation {
  const { clipId } = operation;
  if (!trackHoldingClip(state, clipId)) return { ok: false, reason: 'clip-not-found', clipId };
  const clipEndValid = operation.clipEnd === undefined || isNonNegativeTime(operation.clipEnd);
  return isPositiveDuration(operation.newDuration) && clipEndValid ? VALID : invalidTime(clipId);
}

/**
 * 字幕批量载荷的边界防御（spec §6.4）。
 *
 * **必须显式加 case**：`validateOperationTargets` 的 `default` 分支返回 VALID，
 * 漏掉它就等于对字幕载荷完全放行——负时间会一路走到 `TimePosition.create`，
 * 在 `TimelinePanel` 的 React effect 里抛异常（那里没有 error boundary）。
 *
 * 拒绝原因复用既有枚举（`'invalid-time'` / `'target-track-missing'`），不新增
 * `OperationRejectReason`：UI 文案表 `ToolStep.REJECT_REASON_KEYS` 因此不需要
 * 任何改动。校验只做「结构、目标轨与时间」——行字数、重叠告警都是工具的
 * V10/V11 职责，不是拒绝条件。
 */
function validateAddSubtitleClips(
  state: TimelineState,
  operation: AddSubtitleClipsOperation,
): OperationValidation {
  const { trackId, clips } = operation;
  if (!trackId) {
    return { ok: false, reason: 'target-track-missing', trackId };
  }
  // 显式 id 命中了视频/音频轨：整批拒绝，绝不把字幕写进素材轨——那会同时污染
  // 预览（按 item.type 过滤）与导出（按 track.type 过滤）。
  const target = state.tracks.find(track => track.id === trackId);
  if (target && target.type !== 'subtitle') {
    return { ok: false, reason: 'target-track-missing', trackId };
  }
  if (!Array.isArray(clips) || clips.length === 0) {
    return { ok: false, reason: 'invalid-time', trackId };
  }
  if (subtitleStyleProblem(operation.style) !== null) {
    return { ok: false, reason: 'invalid-time', trackId };
  }
  const ordered = [...clips].sort((left, right) => left.startTime - right.startTime);
  let previousEnd = -Infinity;
  for (const clip of ordered) {
    if (!isNonNegativeTime(clip.startTime) || !isPositiveDuration(clip.duration)) {
      return { ok: false, reason: 'invalid-time', trackId, clipId: clip.id };
    }
    if (clip.startTime < previousEnd - OVERLAP_EPSILON) {
      return { ok: false, reason: 'invalid-time', trackId, clipId: clip.id };
    }
    previousEnd = Math.max(previousEnd, clip.startTime + clip.duration);
  }
  return VALID;
}

export function validateOperationTargets(
  state: TimelineState,
  operation: GuardedOperation,
): OperationValidation {
  switch (operation.type) {
    case 'add_clip':
      return validateAddClip(operation);
    case 'delete_clip':
      return validateDelete(state, operation.trackId, operation.clipId);
    case 'move_clip':
      return validateMove(state, operation);
    case 'trim_clip':
      return validateTrim(state, operation);
    case 'resize_clip':
      return validateResize(state, operation);
    case 'add_subtitle_clips':
      return validateAddSubtitleClips(state, operation);
    default:
      return VALID;
  }
}
