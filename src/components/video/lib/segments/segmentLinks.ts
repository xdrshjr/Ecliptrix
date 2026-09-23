/**
 * segmentLinks — read-only derivation of "which script segment does this
 * belong to" for the segment-centric workbench (spec §3.4.2).
 *
 * A segment is a VIEW concept: nothing here writes back. Every link is derived
 * from fields that already exist — `TimelineItem.sentenceSegments.segment_id`,
 * `MaterialItem.metadata.segment_id` / `linkedSegmentId` and
 * `metadata.segment_text_hash` — so the script cards, timeline labels, the
 * materials "used in segment N" chips and the assistant context line all read
 * one derivation instead of three stores guessing at each other.
 */

import type { MaterialItem, ScriptSegment } from '@/types';
import { segmentTextHash } from '../aiMix/segmentTextHash';

/** The minimal timeline item shape the derivation reads. */
export interface LinkableItem {
  id: string;
  type: string;
  startTime: number;
  duration: number;
  materialId?: string;
  originalMaterialType?: string;
  metadata?: Record<string, unknown>;
  sentenceSegments?: { segment_id?: string; total_duration?: number } | null;
}

/** The minimal track shape the derivation reads. */
export interface LinkableTrack {
  id: string;
  type: string;
  items: readonly LinkableItem[];
}

export interface SegmentIndexEntry {
  segmentId: string;
  /** 1-based position in the script. */
  ordinal: number;
  title: string;
  /** Zero-padded ordinal, e.g. "01". */
  badge: string;
  /** "01 丝滑亮相" — identical in cards, timeline labels and the drawer. */
  label: string;
}

export interface SegmentTimeRange {
  start: number;
  end: number;
}

export type VisualStatus = 'configured' | 'missing';
export type VoiceStatus = 'none' | 'generating' | 'ready' | 'stale';
export type SubtitleStatus = 'none' | 'ready';
/** Whether the narration on the timeline is the latest voice-over (RV-02). */
export type VoiceOnTimeline = 'current' | 'outdated' | 'absent';

export interface SegmentStatus {
  visual: VisualStatus;
  voice: VoiceStatus;
  voiceOnTimeline: VoiceOnTimeline;
  subtitle: SubtitleStatus;
}

export function formatSegmentBadge(ordinal: number): string {
  return String(ordinal).padStart(2, '0');
}

export function buildSegmentIndex(
  segments: readonly ScriptSegment[],
): Map<string, SegmentIndexEntry> {
  const index = new Map<string, SegmentIndexEntry>();
  segments.forEach((segment) => {
    if (index.has(segment.id)) return; // a duplicated id keeps its first slot
    const ordinal = index.size + 1;
    const badge = formatSegmentBadge(ordinal);
    const title = (segment.title ?? '').trim();
    index.set(segment.id, {
      segmentId: segment.id,
      ordinal,
      title,
      badge,
      label: title ? `${badge} ${title}` : badge,
    });
  });
  return index;
}

export function buildMaterialsById(
  materials: readonly MaterialItem[],
): Map<string, MaterialItem> {
  return new Map(materials.map((material) => [material.id, material]));
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Timeline item → owning segment id. Priority: the item's own sentence
 * segments, then its source material's `segment_id`, then a `linkedSegmentId`
 * (AI video generated for a sentence) on the material or the item snapshot.
 */
export function resolveItemSegmentId(
  item: LinkableItem,
  materialsById: ReadonlyMap<string, MaterialItem>,
): string | null {
  const fromSentences = readString(item.sentenceSegments?.segment_id);
  if (fromSentences) return fromSentences;
  const material = item.materialId ? materialsById.get(item.materialId) : undefined;
  const fromMaterial = readString(material?.metadata?.segment_id);
  if (fromMaterial) return fromMaterial;
  return readString(material?.metadata?.linkedSegmentId)
    ?? readString(item.metadata?.linkedSegmentId);
}

function forEachItem(
  tracks: readonly LinkableTrack[],
  visit: (item: LinkableItem, track: LinkableTrack) => void,
): void {
  tracks.forEach((track) => track.items.forEach((item) => visit(item, track)));
}

export function collectSegmentItemIds(
  tracks: readonly LinkableTrack[],
  materialsById: ReadonlyMap<string, MaterialItem>,
  segmentId: string,
): string[] {
  const ids: string[] = [];
  forEachItem(tracks, (item) => {
    if (resolveItemSegmentId(item, materialsById) === segmentId) ids.push(item.id);
  });
  return ids;
}

function isVisualItem(item: LinkableItem): boolean {
  return item.type === 'video';
}

function extend(range: SegmentTimeRange | null, item: LinkableItem): SegmentTimeRange {
  const end = item.startTime + item.duration;
  if (!range) return { start: item.startTime, end };
  return { start: Math.min(range.start, item.startTime), end: Math.max(range.end, end) };
}

/** Narration (audio) items first; visual items only when there is none. */
export function computeSegmentTimeRange(
  tracks: readonly LinkableTrack[],
  materialsById: ReadonlyMap<string, MaterialItem>,
  segmentId: string,
): SegmentTimeRange | null {
  let audio: SegmentTimeRange | null = null;
  let visual: SegmentTimeRange | null = null;
  forEachItem(tracks, (item) => {
    if (resolveItemSegmentId(item, materialsById) !== segmentId) return;
    if (item.type === 'audio') audio = extend(audio, item);
    else if (isVisualItem(item)) visual = extend(visual, item);
  });
  return audio ?? visual;
}

function assignedAt(material: MaterialItem): number {
  const stamp: unknown = material.metadata?.segment_assigned_at;
  return typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : -Infinity;
}

/** The newest voice-over material written for the segment, if any. */
export function findLatestVoiceMaterial(
  materials: readonly MaterialItem[],
  segmentId: string,
): MaterialItem | null {
  let latest: MaterialItem | null = null;
  materials.forEach((material) => {
    if (material.type !== 'audio' || material.metadata?.segment_id !== segmentId) return;
    if (!latest || assignedAt(material) >= assignedAt(latest)) latest = material;
  });
  return latest;
}

/** Mirrors `planScriptAutoMix.isStaleVoiceOver`: an unstamped voice counts. */
function isVoiceStale(material: MaterialItem, segment: ScriptSegment): boolean {
  const stamped: unknown = material.metadata?.segment_text_hash;
  return typeof stamped === 'string' && stamped !== segmentTextHash(segment);
}

function deriveVoiceOnTimeline(
  tracks: readonly LinkableTrack[],
  materialsById: ReadonlyMap<string, MaterialItem>,
  segmentId: string,
  latest: MaterialItem | null,
): VoiceOnTimeline {
  let found = false;
  let current = false;
  forEachItem(tracks, (item) => {
    if (item.type !== 'audio') return;
    if (resolveItemSegmentId(item, materialsById) !== segmentId) return;
    found = true;
    if (latest && item.materialId === latest.id) current = true;
  });
  if (!found) return 'absent';
  return current ? 'current' : 'outdated';
}

function hasOverlappingSubtitle(
  tracks: readonly LinkableTrack[],
  range: SegmentTimeRange | null,
): boolean {
  if (!range) return false;
  return tracks.some((track) => track.type === 'subtitle' && track.items.some(
    (item) => item.startTime < range.end && item.startTime + item.duration > range.start,
  ));
}

export interface DeriveSegmentStatusInput {
  segment: ScriptSegment;
  materials: readonly MaterialItem[];
  tracks: readonly LinkableTrack[];
  isConverting: boolean;
  /** Optional pre-built lookup; built from `materials` when omitted. */
  materialsById?: ReadonlyMap<string, MaterialItem>;
}

export function deriveSegmentStatus(input: DeriveSegmentStatusInput): SegmentStatus {
  const { segment, materials, tracks, isConverting } = input;
  const byId = input.materialsById ?? buildMaterialsById(materials);
  const linkedIds = collectSegmentItemIds(tracks, byId, segment.id);
  const linked = new Set(linkedIds);
  let hasVisualItem = false;
  forEachItem(tracks, (item) => {
    if (linked.has(item.id) && isVisualItem(item)) hasVisualItem = true;
  });
  const latest = findLatestVoiceMaterial(materials, segment.id);
  let voice: VoiceStatus = 'none';
  if (isConverting) voice = 'generating';
  else if (latest) voice = isVoiceStale(latest, segment) ? 'stale' : 'ready';
  const range = computeSegmentTimeRange(tracks, byId, segment.id);
  return {
    visual: (segment.videos?.length ?? 0) > 0 || hasVisualItem ? 'configured' : 'missing',
    voice,
    voiceOnTimeline: deriveVoiceOnTimeline(tracks, byId, segment.id, latest),
    subtitle: hasOverlappingSubtitle(tracks, range) ? 'ready' : 'none',
  };
}

/** The segment whose range holds `currentTime`; null in the gaps. */
export function findPlayingSegmentId(
  ranges: ReadonlyMap<string, SegmentTimeRange>,
  currentTime: number,
): string | null {
  let playing: string | null = null;
  ranges.forEach((range, segmentId) => {
    if (playing === null && currentTime >= range.start && currentTime < range.end) {
      playing = segmentId;
    }
  });
  return playing;
}

/** Card duration fallback chain (RV-11): field → range → voice length. */
export function resolveSegmentDuration(
  segment: ScriptSegment,
  range: SegmentTimeRange | null,
  latestVoice: MaterialItem | null,
): number | null {
  if (typeof segment.duration === 'number' && segment.duration > 0) return segment.duration;
  if (range && range.end > range.start) return range.end - range.start;
  const voiceLength = latestVoice?.sentenceSegments?.total_duration ?? latestVoice?.duration;
  return typeof voiceLength === 'number' && voiceLength > 0 ? voiceLength : null;
}
