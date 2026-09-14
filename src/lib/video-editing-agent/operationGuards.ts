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
  AgentTimelineOperation,
  OperationRejectReason,
  TimelineState,
  Track,
} from '@/types';
import type { TimelineOperation } from './types';

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
    default:
      return VALID;
  }
}
