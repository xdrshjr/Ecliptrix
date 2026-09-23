/**
 * segmentCommands — pure planners for the segment-level commands of the
 * workbench (spec R2 §3.2): apply a voice-over, replace the visual, remove a
 * segment, reorder segments.
 *
 * Every planner turns one user intent into ONE plan: the complete new track
 * list, a script patch (`ScriptOp[]`) and a human-readable impact. Nothing
 * here touches a store: `applySegmentCommandAction` writes the plan as a
 * single undoable history entry, so the script, timeline and material views
 * of a segment change together instead of guessing at each other.
 *
 * File exceeds the 600-line budget by design: the four planners share the
 * private impact / patch helpers above them, and the geometry that CAN live
 * apart already does (segmentCommandGeometry.ts, fillSpanWithMaterial.ts).
 */

import type { MaterialItem, ScriptSegment } from '@/types';
import type { TimelineItemData, TrackData } from '@/components/video/timeline/domain';
import type { ScriptOp } from '@/components/video/timeline/store/historyCompanion';
import { resolveAutoMixTargetTracks } from '@/components/video/timeline/store/actions/applyScriptAutoMix';
import { segmentTextHash } from '../aiMix/segmentTextHash';
import {
  computeSegmentTimeRange,
  resolveItemSegmentId,
  type SegmentStatus,
} from './segmentLinks';
import {
  buildItemForClip,
  fillSpanWithMaterial,
  MIN_CLIP_SECONDS,
  roundTime,
} from './fillSpanWithMaterial';
import {
  buildItemOwnerLookup,
  computeSegmentBlocks,
  computeTotalDuration,
  EPS,
  isMusicTrack,
  isSegmentBearingTrack,
  itemEnd,
  replaceTrack,
  shiftItemsFrom,
  sortItems,
} from './segmentCommandGeometry';
import { readMaterialSegmentStamp } from './stampMaterialForSegment';

export type SegmentRefusal =
  | 'edit-locked' | 'segment-not-found' | 'not-on-timeline'
  | 'target-track-locked' | 'no-target-track' | 'span-occupied'
  | 'interleaved' | 'candidate-stale' | 'nothing-to-do';

export interface SegmentImpact {
  /** Change of this segment's length (s, positive = longer); 0 = unchanged. */
  durationDelta: number;
  /** Other segments whose start moved (1-based ordinals, ascending). */
  shiftedSegmentOrdinals: number[];
  /** Moved clips that belong to no segment (e.g. an unassigned subtitle). */
  shiftedLooseItemCount: number;
  /** Locked lanes with content after the affected point (kept in place). */
  lockedTrackNames: string[];
  /** Background-music lanes with content after the affected point (kept). */
  untouchedMusicTrackNames: string[];
  /** Clips removed, grouped by lane display name (delete dialog). */
  removedItems: { trackName: string; count: number }[];
  /** Linked clips kept because their lane is locked. */
  keptLockedItems: { trackName: string; count: number }[];
  /** Gap left on the timeline by a removal (s). */
  gapSeconds: number;
  totalDurationBefore: number;
  totalDurationAfter: number;
}

export interface SegmentCommandPlan {
  ok: true;
  /** Tracks read when planning; compared before applying (RV2-05). */
  baseTracks: TrackData[];
  /** Complete new track list (untouched lanes keep their reference). */
  tracks: TrackData[];
  scriptOps: ScriptOp[];
  impact: SegmentImpact;
  /** Library copies the plan's clips reference (added before applying). */
  addedMaterials: MaterialItem[];
}

export type SegmentCommandResult = SegmentCommandPlan | { ok: false; reason: SegmentRefusal };

export interface SegmentPlanContext {
  tracks: TrackData[];
  materialsById: ReadonlyMap<string, MaterialItem>;
  segments: readonly ScriptSegment[];
  /** Lane display name (deriveTrackDisplayName); defaults to name / id. */
  trackName?: (track: TrackData) => string;
}

const refuse = (reason: SegmentRefusal): { ok: false; reason: SegmentRefusal } =>
  ({ ok: false, reason });

const nameOf = (context: SegmentPlanContext, track: TrackData): string =>
  context.trackName?.(track) ?? (track.name || track.id);

// ---------------------------------------------------------------------------
// Impact
// ---------------------------------------------------------------------------

interface ImpactInput {
  after: TrackData[];
  fromTime: number;
  durationDelta?: number;
  segmentId?: string;
  movedItemIds?: readonly string[];
  removedItems?: SegmentImpact['removedItems'];
  keptLockedItems?: SegmentImpact['keptLockedItems'];
  gapSeconds?: number;
  /** Script order after the command (reorder); defaults to context.segments. */
  orderAfter?: readonly string[];
}

function tracksWithContentAfter(
  tracks: readonly TrackData[],
  fromTime: number,
  keep: (track: TrackData) => boolean,
): TrackData[] {
  return tracks.filter((track) =>
    keep(track) && track.items.some((item) => itemEnd(item) > fromTime + EPS));
}

function buildImpact(context: SegmentPlanContext, input: ImpactInput): SegmentImpact {
  const { tracks: before, materialsById } = context;
  const blocksBefore = computeSegmentBlocks(before, materialsById);
  const blocksAfter = computeSegmentBlocks(input.after, materialsById);
  const order = input.orderAfter ?? context.segments.map((segment) => segment.id);
  const shiftedSegmentOrdinals: number[] = [];
  order.forEach((id, position) => {
    if (id === input.segmentId) return;
    const from = blocksBefore.get(id);
    const to = blocksAfter.get(id);
    if (from && to && Math.abs(from.start - to.start) > EPS) shiftedSegmentOrdinals.push(position + 1);
  });
  const ownerOf = buildItemOwnerLookup(before, materialsById);
  const moved = new Set(input.movedItemIds ?? []);
  let shiftedLooseItemCount = 0;
  before.forEach((track) => track.items.forEach((item) => {
    if (moved.has(item.id) && ownerOf(item) === null) shiftedLooseItemCount += 1;
  }));
  return {
    durationDelta: roundTime(input.durationDelta ?? 0),
    shiftedSegmentOrdinals,
    shiftedLooseItemCount,
    lockedTrackNames: tracksWithContentAfter(before, input.fromTime, (track) => track.isLocked)
      .map((track) => nameOf(context, track)),
    untouchedMusicTrackNames: tracksWithContentAfter(before, input.fromTime,
      (track) => isMusicTrack(track, materialsById)).map((track) => nameOf(context, track)),
    removedItems: input.removedItems ?? [],
    keptLockedItems: input.keptLockedItems ?? [],
    gapSeconds: roundTime(input.gapSeconds ?? 0),
    totalDurationBefore: computeTotalDuration(before),
    totalDurationAfter: computeTotalDuration(input.after),
  };
}

function finishPlan(
  context: SegmentPlanContext,
  tracks: TrackData[],
  scriptOps: ScriptOp[],
  impact: ImpactInput,
  addedMaterials: MaterialItem[] = [],
): SegmentCommandPlan {
  return {
    ok: true,
    baseTracks: context.tracks,
    tracks,
    scriptOps,
    impact: buildImpact(context, impact),
    addedMaterials,
  };
}

/** A plan that only patches the script (segment not on the timeline, lock). */
export function planScriptOnly(
  context: SegmentPlanContext,
  scriptOps: ScriptOp[],
): SegmentCommandPlan {
  return finishPlan(context, context.tracks, scriptOps, { after: context.tracks, fromTime: 0 });
}

function findSegment(context: SegmentPlanContext, segmentId: string): ScriptSegment | null {
  return context.segments.find((segment) => segment.id === segmentId) ?? null;
}

function patchOp(
  segment: ScriptSegment,
  after: Partial<ScriptSegment>,
): ScriptOp {
  const before: Partial<ScriptSegment> = {};
  const source = segment as unknown as Record<string, unknown>;
  const target = before as Record<string, unknown>;
  Object.keys(after).forEach((key) => { target[key] = structuredClone(source[key]); });
  return { type: 'patch-segment', segmentId: segment.id, before, after };
}

// ---------------------------------------------------------------------------
// Apply a voice-over
// ---------------------------------------------------------------------------

export interface PlanVoiceApplyInput {
  segmentId: string;
  candidate: MaterialItem;
  lengthMode: 'adjust' | 'keep';
  /** Only the explicit "voice versions › use this" entry passes true (RV2-02). */
  allowStale?: boolean;
  /** ISO time written to `appliedVoiceAt`. */
  appliedAt: string;
}

export function isCandidateStale(candidate: MaterialItem, segment: ScriptSegment): boolean {
  const stamped: unknown = candidate.metadata?.segment_text_hash;
  return typeof stamped === 'string' && stamped !== segmentTextHash(segment);
}

export function voiceLength(material: MaterialItem): number {
  const length = material.duration ?? material.sentenceSegments?.total_duration ?? 0;
  return roundTime(length > 0 ? length : 0);
}

interface VoiceSpan { oldStart: number; oldEnd: number; replaced: TimelineItemData[] }

/** Where the voice goes: its old narration, else the segment span, else an insert. */
function resolveVoiceSpan(
  context: SegmentPlanContext,
  narration: TrackData,
  segmentId: string,
): VoiceSpan {
  const { tracks, materialsById, segments } = context;
  const replaced = narration.items.filter((item) =>
    item.type === 'audio' && resolveItemSegmentId(item, materialsById) === segmentId);
  if (replaced.length > 0) {
    return {
      oldStart: Math.min(...replaced.map((item) => item.startTime)),
      oldEnd: Math.max(...replaced.map(itemEnd)),
      replaced,
    };
  }
  const range = computeSegmentTimeRange(tracks, materialsById, segmentId);
  if (range) return { oldStart: range.start, oldEnd: range.end, replaced };
  const blocks = computeSegmentBlocks(tracks, materialsById);
  const position = segments.findIndex((segment) => segment.id === segmentId);
  const previous = segments.slice(0, Math.max(position, 0)).reverse()
    .map((segment) => blocks.get(segment.id)).find((block) => block !== undefined);
  const insertAt = previous ? previous.end : 0;
  return { oldStart: insertAt, oldEnd: insertAt, replaced };
}

/** Stretch (delta > 0) or trim (delta < 0) the segment's own picture by delta. */
function resizeOwnVisuals(
  track: TrackData,
  own: readonly TimelineItemData[],
  delta: number,
  materialsById: ReadonlyMap<string, MaterialItem>,
): TrackData {
  if (own.length === 0 || Math.abs(delta) < EPS) return track;
  const ownIds = new Set(own.map((item) => item.id));
  const others = track.items.filter((item) => !ownIds.has(item.id));
  const visualEnd = Math.max(...own.map(itemEnd));
  const targetEnd = roundTime(visualEnd + delta);
  const resized: TimelineItemData[] = [];
  sortItems(own).forEach((item) => {
    if (delta < 0) {
      if (item.startTime >= targetEnd - MIN_CLIP_SECONDS + EPS) return;
      if (itemEnd(item) <= targetEnd + EPS) { resized.push(item); return; }
      const duration = roundTime(targetEnd - item.startTime);
      resized.push({ ...item, duration, clipEnd: roundTime((item.clipStart ?? 0) + duration) });
      return;
    }
    resized.push(item);
  });
  if (delta > 0) extendLastVisual(track, resized, targetEnd, own, materialsById);
  return { ...track, items: sortItems([...others, ...resized]) };
}

function extendLastVisual(
  track: TrackData,
  resized: TimelineItemData[],
  targetEnd: number,
  own: readonly TimelineItemData[],
  materialsById: ReadonlyMap<string, MaterialItem>,
): void {
  const lastIndex = resized.reduce((best, item, index) =>
    (itemEnd(item) > itemEnd(resized[best]) ? index : best), 0);
  const last = resized[lastIndex];
  const want = targetEnd - itemEnd(last);
  const isImage = last.originalMaterialType === 'image';
  const clipEnd = last.clipEnd ?? (last.clipStart ?? 0) + last.duration;
  const room = isImage || !last.originalDuration ? want : Math.max(0, last.originalDuration - clipEnd);
  const grow = roundTime(Math.min(want, room));
  if (grow > EPS) {
    resized[lastIndex] = {
      ...last, duration: roundTime(last.duration + grow), clipEnd: roundTime(clipEnd + grow),
    };
  }
  const gapStart = itemEnd(resized[lastIndex]);
  const firstMaterial = own[0]?.materialId ? materialsById.get(own[0].materialId) : undefined;
  if (targetEnd - gapStart < MIN_CLIP_SECONDS - EPS || !firstMaterial) return;
  const segmentId = resolveItemSegmentId(own[0], materialsById);
  fillSpanWithMaterial(firstMaterial, track, gapStart, roundTime(targetEnd - gapStart)).items
    .forEach((item) => resized.push(segmentId ? withSegmentLink(item, segmentId) : item));
}

function withSegmentLink(item: TimelineItemData, segmentId: string): TimelineItemData {
  return { ...item, metadata: { ...item.metadata, linkedSegmentId: segmentId } };
}

function overlapsSpan(item: TimelineItemData, start: number, end: number): boolean {
  return item.startTime < end - EPS && itemEnd(item) > start + EPS;
}

// Function exceeds 60 lines by design: the three placement cases share one
// lock/shift pipeline and splitting them hides the order of the steps.
export function planSegmentVoiceApply(
  context: SegmentPlanContext,
  input: PlanVoiceApplyInput,
): SegmentCommandResult {
  const segment = findSegment(context, input.segmentId);
  if (!segment) return refuse('segment-not-found');
  if (!input.allowStale && isCandidateStale(input.candidate, segment)) {
    return refuse('candidate-stale');
  }
  const { tracks, materialsById } = context;
  const { audioTrackId, videoTrackId } = resolveAutoMixTargetTracks(tracks);
  const narration = tracks.find((track) => track.id === audioTrackId);
  if (!narration) return refuse('no-target-track');
  if (narration.isLocked) return refuse('target-track-locked');
  const newDur = voiceLength(input.candidate);
  if (newDur < MIN_CLIP_SECONDS) return refuse('nothing-to-do');

  const span = resolveVoiceSpan(context, narration, segment.id);
  const replacedIds = new Set(span.replaced.map((item) => item.id));
  if (narration.items.some((item) => !replacedIds.has(item.id)
    && overlapsSpan(item, span.oldStart, span.oldEnd))) {
    return refuse('interleaved');
  }
  const delta = roundTime(newDur - (span.oldEnd - span.oldStart));
  const keep = input.lengthMode === 'keep' && span.replaced.length > 0 && delta < 0;
  const voiceItem = buildItemForClip(narration, {
    material: input.candidate, startTime: span.oldStart, duration: newDur, clipStart: 0, clipEnd: newDur,
  });
  let next = replaceTrack(tracks, narration.id, (track) => ({
    ...track,
    items: sortItems([...track.items.filter((item) => !replacedIds.has(item.id)), voiceItem]),
  }));
  let movedItemIds: string[] = [];
  if (!keep && Math.abs(delta) > EPS) {
    const ownerOf = buildItemOwnerLookup(tracks, materialsById);
    const pinned = new Set<string>([voiceItem.id]);
    tracks.forEach((track) => track.items.forEach((item) => {
      if (ownerOf(item) === segment.id) pinned.add(item.id);
    }));
    const mainTrack = next.find((track) => track.id === videoTrackId);
    if (mainTrack && !mainTrack.isLocked) {
      const ownVisuals = mainTrack.items.filter((item) =>
        item.type === 'video' && ownerOf(item) === segment.id);
      const resizedMain = resizeOwnVisuals(mainTrack, ownVisuals, delta, materialsById);
      const untouched = new Set(mainTrack.items.map((item) => item.id));
      ownVisuals.forEach((item) => untouched.delete(item.id));
      resizedMain.items.forEach((item) => { if (!untouched.has(item.id)) pinned.add(item.id); });
      next = replaceTrack(next, mainTrack.id, () => resizedMain);
    }
    const eligible = new Set(tracks
      .filter((track) => isSegmentBearingTrack(track, materialsById)).map((track) => track.id));
    eligible.add(narration.id);
    const shifted = shiftItemsFrom(next, span.oldEnd, delta, { eligibleTrackIds: eligible, pinnedItemIds: pinned });
    if (!shifted.ok) return refuse('interleaved');
    next = shifted.tracks;
    movedItemIds = shifted.movedItemIds;
  }
  const scriptOps = [patchOp(segment, {
    appliedVoiceMaterialId: input.candidate.id,
    appliedVoiceAt: input.appliedAt,
    duration: newDur,
  })];
  return finishPlan(context, next, scriptOps, {
    after: next,
    fromTime: span.oldEnd,
    durationDelta: keep ? 0 : delta,
    segmentId: segment.id,
    movedItemIds,
  });
}

export interface VoiceApplyManyResult {
  plan: SegmentCommandPlan | null;
  applied: { segmentId: string; durationDelta: number }[];
  skipped: { segmentId: string; reason: SegmentRefusal }[];
}

/** Apply several segments' candidates as ONE plan, in script order (§3.5). */
export function planSegmentVoiceApplyMany(
  context: SegmentPlanContext,
  entries: readonly { segmentId: string; candidate: MaterialItem }[],
  appliedAt: string,
): VoiceApplyManyResult {
  let tracks = context.tracks;
  let segments = context.segments;
  const scriptOps: ScriptOp[] = [];
  const applied: VoiceApplyManyResult['applied'] = [];
  const skipped: VoiceApplyManyResult['skipped'] = [];
  const order = new Map(context.segments.map((segment, index) => [segment.id, index]));
  const sorted = [...entries].sort((a, b) =>
    (order.get(a.segmentId) ?? 0) - (order.get(b.segmentId) ?? 0));
  sorted.forEach(({ segmentId, candidate }) => {
    const result = planSegmentVoiceApply({ ...context, tracks, segments }, {
      segmentId, candidate, lengthMode: 'adjust', appliedAt,
    });
    if (!result.ok) { skipped.push({ segmentId, reason: result.reason }); return; }
    tracks = result.tracks;
    scriptOps.push(...result.scriptOps);
    segments = segments.map((segment) => (segment.id === segmentId
      ? { ...segment, appliedVoiceMaterialId: candidate.id, appliedVoiceAt: appliedAt }
      : segment));
    applied.push({ segmentId, durationDelta: result.impact.durationDelta });
  });
  if (applied.length === 0) return { plan: null, applied, skipped };
  const plan = finishPlan(context, tracks, scriptOps, { after: tracks, fromTime: 0 });
  return { plan, applied, skipped };
}

// ---------------------------------------------------------------------------
// Replace the visual
// ---------------------------------------------------------------------------

export interface PlanVisualReplaceInput {
  segmentId: string;
  material: MaterialItem;
  /** Id for a stamped copy when the material belongs to another segment. */
  copyId: string;
  /** Builds the stamped copy (stampMaterialForSegment with i18n bound). */
  stampCopy: (material: MaterialItem, copyId: string) => MaterialItem;
}

function withMaterial(
  materialsById: ReadonlyMap<string, MaterialItem>,
  material: MaterialItem,
): Map<string, MaterialItem> {
  const next = new Map<string, MaterialItem>();
  materialsById.forEach((value, key) => next.set(key, value));
  next.set(material.id, material);
  return next;
}

export function planSegmentVisualReplace(
  context: SegmentPlanContext,
  input: PlanVisualReplaceInput,
): SegmentCommandResult {
  const segment = findSegment(context, input.segmentId);
  if (!segment) return refuse('segment-not-found');
  const { tracks, materialsById } = context;
  const { videoTrackId } = resolveAutoMixTargetTracks(tracks);
  const main = tracks.find((track) => track.id === videoTrackId);
  if (!main) return refuse('no-target-track');
  if (main.isLocked) return refuse('target-track-locked');
  const own = main.items.filter((item) =>
    item.type === 'video' && resolveItemSegmentId(item, materialsById) === segment.id);
  let start: number;
  let end: number;
  if (own.length > 0) {
    start = Math.min(...own.map((item) => item.startTime));
    end = Math.max(...own.map(itemEnd));
  } else {
    const range = computeSegmentTimeRange(tracks, materialsById, segment.id);
    if (!range) return refuse('not-on-timeline');
    ({ start, end } = range);
  }
  const ownIds = new Set(own.map((item) => item.id));
  const others = main.items.filter((item) => !ownIds.has(item.id));
  if (others.some((item) => overlapsSpan(item, start, end))) return refuse('span-occupied');

  const stamp = readMaterialSegmentStamp(input.material);
  const needsCopy = stamp !== null && stamp !== segment.id;
  const source = needsCopy ? input.stampCopy(input.material, input.copyId) : input.material;
  const filled = fillSpanWithMaterial(source, main, start, roundTime(end - start)).items
    .map((item) => (stamp === null ? withSegmentLink(item, segment.id) : item));
  // A video of unknown / sub-0.1 s length fills nothing: never swap the
  // segment's picture for an empty span.
  if (filled.length === 0) return refuse('nothing-to-do');
  const next = replaceTrack(tracks, main.id, (track) => ({
    ...track, items: sortItems([...others, ...filled]),
  }));
  const scriptOps = [patchOp(segment, { videos: [source] })];
  const planContext: SegmentPlanContext = needsCopy
    ? { ...context, materialsById: withMaterial(materialsById, source) }
    : context;
  return finishPlan(planContext, next, scriptOps, {
    after: next, fromTime: end, segmentId: segment.id,
  }, needsCopy ? [source] : []);
}

/** "Not on the timeline yet": the picked material only becomes the segment's candidate. */
export function planSegmentVisualCandidate(
  context: SegmentPlanContext,
  segmentId: string,
  material: MaterialItem,
): SegmentCommandResult {
  const segment = findSegment(context, segmentId);
  if (!segment) return refuse('segment-not-found');
  return planScriptOnly(context, [patchOp(segment, { videos: [material] })]);
}

// ---------------------------------------------------------------------------
// Remove a segment
// ---------------------------------------------------------------------------

function countByTrack(
  context: SegmentPlanContext,
  tracks: readonly TrackData[],
  matches: (item: TimelineItemData) => boolean,
): { trackName: string; count: number }[] {
  return tracks
    .map((track) => ({ trackName: nameOf(context, track), count: track.items.filter(matches).length }))
    .filter((entry) => entry.count > 0);
}

export function planSegmentRemoval(
  context: SegmentPlanContext,
  input: { segmentId: string; removeTimelineItems: boolean },
): SegmentCommandResult {
  const index = context.segments.findIndex((segment) => segment.id === input.segmentId);
  if (index < 0) return refuse('segment-not-found');
  const segment = context.segments[index];
  const scriptOps: ScriptOp[] = [
    { type: 'remove-segment', segment: structuredClone(segment), index },
  ];
  if (!input.removeTimelineItems) return planScriptOnly(context, scriptOps);
  const { tracks, materialsById } = context;
  const ownerOf = buildItemOwnerLookup(tracks, materialsById);
  const owned = (item: TimelineItemData) => ownerOf(item) === segment.id;
  const unlocked = tracks.filter((track) => !track.isLocked);
  const locked = tracks.filter((track) => track.isLocked);
  const next = tracks.map((track) => {
    if (track.isLocked || !track.items.some(owned)) return track;
    return { ...track, items: track.items.filter((item) => !owned(item)) };
  });
  const block = computeSegmentBlocks(tracks, materialsById).get(segment.id);
  return finishPlan(context, next, scriptOps, {
    after: next,
    fromTime: block?.end ?? 0,
    segmentId: segment.id,
    removedItems: countByTrack(context, unlocked, owned),
    keptLockedItems: countByTrack(context, locked, owned),
    gapSeconds: block ? block.end - block.start : 0,
  });
}

// ---------------------------------------------------------------------------
// Reorder segments
// ---------------------------------------------------------------------------

function moveId(order: readonly string[], from: number, to: number): string[] {
  const next = order.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The script-only reorder patch (used when the clips cannot move along). */
export function buildReorderOp(
  segments: readonly ScriptSegment[],
  segmentId: string,
  toIndex: number,
): ScriptOp | null {
  const beforeOrder = segments.map((segment) => segment.id);
  const from = beforeOrder.indexOf(segmentId);
  const to = Math.min(Math.max(toIndex, 0), beforeOrder.length - 1);
  if (from < 0 || from === to) return null;
  return { type: 'reorder', beforeOrder, afterOrder: moveId(beforeOrder, from, to) };
}

// Function exceeds 60 lines by design: the feasibility checks and the block
// layout read one set of blocks and must stay in one place to stay in sync.
export function planSegmentReorder(
  context: SegmentPlanContext,
  input: { segmentId: string; toIndex: number },
): SegmentCommandResult {
  const beforeOrder = context.segments.map((segment) => segment.id);
  const from = beforeOrder.indexOf(input.segmentId);
  if (from < 0) return refuse('segment-not-found');
  const to = Math.min(Math.max(input.toIndex, 0), beforeOrder.length - 1);
  if (to === from) return refuse('nothing-to-do');
  const afterOrder = moveId(beforeOrder, from, to);
  const scriptOps: ScriptOp[] = [{ type: 'reorder', beforeOrder, afterOrder }];
  const { tracks, materialsById } = context;
  const blocks = computeSegmentBlocks(tracks, materialsById);
  const involved = beforeOrder.slice(Math.min(from, to), Math.max(from, to) + 1);
  const placed = involved.filter((id) => blocks.has(id));
  if (placed.length === 0) return planScriptOnly(context, scriptOps);
  if (placed.length !== involved.length) return refuse('not-on-timeline');

  const oldBlocks = involved.map((id) => blocks.get(id)!);
  for (let index = 1; index < oldBlocks.length; index += 1) {
    if (oldBlocks[index].start < oldBlocks[index - 1].end - EPS) return refuse('interleaved');
  }
  const ownerOf = buildItemOwnerLookup(tracks, materialsById);
  const involvedSet = new Set(involved);
  const regionStart = oldBlocks[0].start;
  const regionEnd = oldBlocks[oldBlocks.length - 1].end;
  for (const track of tracks) {
    const ownsInvolved = track.items.some((item) => involvedSet.has(ownerOf(item) ?? ''));
    if (track.isLocked && ownsInvolved) return refuse('target-track-locked');
    if (track.isLocked || isMusicTrack(track, materialsById)) continue;
    const intruder = track.items.some((item) => !involvedSet.has(ownerOf(item) ?? '')
      && item.startTime >= regionStart - EPS && item.startTime < regionEnd - EPS);
    if (intruder) return refuse('interleaved');
  }
  const gaps = oldBlocks.slice(1).map((block, index) => block.start - oldBlocks[index].end);
  const newInvolved = afterOrder.filter((id) => involvedSet.has(id));
  const offsets = new Map<string, number>();
  let cursor = regionStart;
  newInvolved.forEach((id, index) => {
    const block = blocks.get(id)!;
    offsets.set(id, roundTime(cursor - block.start));
    cursor = cursor + (block.end - block.start) + (gaps[index] ?? 0);
  });
  const movedItemIds: string[] = [];
  const next = tracks.map((track) => {
    if (track.isLocked) return track;
    let changed = false;
    const items = track.items.map((item) => {
      const offset = offsets.get(ownerOf(item) ?? '');
      if (offset === undefined || Math.abs(offset) < EPS) return item;
      changed = true;
      movedItemIds.push(item.id);
      return { ...item, startTime: roundTime(item.startTime + offset) };
    });
    return changed ? { ...track, items: sortItems(items) } : track;
  });
  return finishPlan(context, next, scriptOps, {
    after: next, fromTime: regionStart, movedItemIds, orderAfter: afterOrder,
  });
}

// ---------------------------------------------------------------------------
// Batch fill scope (§3.12)
// ---------------------------------------------------------------------------

export interface BatchFillScope {
  /** Segments to (re)generate a voice-over for: none yet, or text changed. */
  voiceTargetIds: string[];
  /** Segments whose voice-over is current (skipped). */
  upToDateIds: string[];
  /** Segments without any picture (listed, never auto-matched). */
  missingVisualIds: string[];
}

export function planBatchFill(
  segments: readonly ScriptSegment[],
  statusById: ReadonlyMap<string, SegmentStatus>,
): BatchFillScope {
  const scope: BatchFillScope = { voiceTargetIds: [], upToDateIds: [], missingVisualIds: [] };
  segments.forEach((segment) => {
    const status = statusById.get(segment.id);
    if (!status) return;
    if (status.voice === 'none' || status.voice === 'stale') scope.voiceTargetIds.push(segment.id);
    else if (status.voice === 'ready') scope.upToDateIds.push(segment.id);
    if (status.visual === 'missing') scope.missingVisualIds.push(segment.id);
  });
  return scope;
}
