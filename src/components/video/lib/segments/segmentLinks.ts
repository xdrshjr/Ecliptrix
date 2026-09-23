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

/** A generated voice-over waiting to be applied to the timeline (R2 §3.4.1). */
export interface VoiceCandidate {
  materialId: string;
  duration: number;
  /** Candidate length minus this segment's narration span; null when absent. */
  deltaFromTimeline: number | null;
  /** Written for an older text: can be auditioned, never applied from the banner. */
  isStale: boolean;
}

export interface SegmentStatus {
  visual: VisualStatus;
  voice: VoiceStatus;
  voiceOnTimeline: VoiceOnTimeline;
  subtitle: SubtitleStatus;
  candidate: VoiceCandidate | null;
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

const MAX_VOICE_VERSIONS = 5;

/** The segment's voice-over materials, newest first (the "voice versions" menu). */
export function listVoiceVersions(
  materials: readonly MaterialItem[],
  segmentId: string,
): MaterialItem[] {
  return materials
    .filter((material) => material.type === 'audio' && material.metadata?.segment_id === segmentId)
    .sort((a, b) => assignedAt(b) - assignedAt(a))
    .slice(0, MAX_VOICE_VERSIONS);
}

/** Voice settings the segment currently asks for (R2 §3.5). */
export interface EffectiveVoice {
  /** Null when neither the segment nor the project chose a voice explicitly. */
  voiceId: string | null;
  speed: number;
}

export function resolveEffectiveVoice(
  segment: ScriptSegment,
  defaultVoiceId?: string,
): EffectiveVoice {
  return { voiceId: segment.voiceId ?? defaultVoiceId ?? null, speed: segment.voiceSpeed ?? 1 };
}

/**
 * Mirrors `planScriptAutoMix.isStaleVoiceOver` (an unstamped voice counts),
 * plus a voice or speed that no longer matches the segment's settings. A
 * material without `voice_speed` was generated at 1.0; one without
 * `voice_type`, or a project that never chose a voice explicitly, skips the
 * voice comparison, so old projects keep their status (I-1).
 */
function isVoiceStale(material: MaterialItem, segment: ScriptSegment, voice: EffectiveVoice): boolean {
  const stamped: unknown = material.metadata?.segment_text_hash;
  if (typeof stamped === 'string' && stamped !== segmentTextHash(segment)) return true;
  const usedVoice: unknown = material.metadata?.voice_type;
  if (voice.voiceId && typeof usedVoice === 'string' && usedVoice !== voice.voiceId) return true;
  const usedSpeed: unknown = material.metadata?.voice_speed;
  const speed = typeof usedSpeed === 'number' && Number.isFinite(usedSpeed) ? usedSpeed : 1;
  return Math.abs(speed - voice.speed) > 1e-6;
}

interface TimelineVoice {
  state: VoiceOnTimeline;
  /** Material of the narration clip on the timeline (first found). */
  materialId: string | null;
  span: SegmentTimeRange | null;
}

/**
 * The narration clip counts as current when it plays the latest voice-over
 * or the one the user explicitly applied (restoring an older version).
 */
function deriveTimelineVoice(
  tracks: readonly LinkableTrack[],
  materialsById: ReadonlyMap<string, MaterialItem>,
  segment: ScriptSegment,
  latest: MaterialItem | null,
): TimelineVoice {
  let span: SegmentTimeRange | null = null;
  let materialId: string | null = null;
  let current = false;
  forEachItem(tracks, (item) => {
    if (item.type !== 'audio') return;
    if (resolveItemSegmentId(item, materialsById) !== segment.id) return;
    span = extend(span, item);
    materialId = materialId ?? item.materialId ?? null;
    if (item.materialId && (item.materialId === latest?.id
      || item.materialId === segment.appliedVoiceMaterialId)) current = true;
  });
  if (!span) return { state: 'absent', materialId: null, span: null };
  return { state: current ? 'current' : 'outdated', materialId, span };
}

function readIsoTime(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function voiceMaterialLength(material: MaterialItem): number {
  return material.duration ?? material.sentenceSegments?.total_duration ?? 0;
}

/**
 * Latest voice-over not on the timeline and not the applied one; after the
 * user applies an older version, only a voice generated LATER is offered
 * again (RV2-03).
 */
function deriveCandidate(
  latest: MaterialItem | null,
  segment: ScriptSegment,
  timelineVoice: TimelineVoice,
  voice: EffectiveVoice,
): VoiceCandidate | null {
  if (!latest) return null;
  if (latest.id === timelineVoice.materialId || latest.id === segment.appliedVoiceMaterialId) return null;
  if (segment.appliedVoiceAt && assignedAt(latest) <= readIsoTime(segment.appliedVoiceAt)) return null;
  const duration = voiceMaterialLength(latest);
  const span: SegmentTimeRange | null = timelineVoice.span;
  return {
    materialId: latest.id,
    duration,
    deltaFromTimeline: span ? duration - (span.end - span.start) : null,
    isStale: isVoiceStale(latest, segment, voice),
  };
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
  /** Persisted project default voice; omitted → voice ids are not compared. */
  defaultVoiceId?: string;
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
  const effectiveVoice = resolveEffectiveVoice(segment, input.defaultVoiceId);
  const timelineVoice = deriveTimelineVoice(tracks, byId, segment, latest);
  // Stale is judged on the voice the timeline plays, else the latest one.
  const onTimeline = timelineVoice.materialId ? byId.get(timelineVoice.materialId) : undefined;
  const judged = onTimeline ?? latest;
  let voice: VoiceStatus = 'none';
  if (isConverting) voice = 'generating';
  else if (judged) voice = isVoiceStale(judged, segment, effectiveVoice) ? 'stale' : 'ready';
  const range = computeSegmentTimeRange(tracks, byId, segment.id);
  return {
    visual: (segment.videos?.length ?? 0) > 0 || hasVisualItem ? 'configured' : 'missing',
    voice,
    voiceOnTimeline: timelineVoice.state,
    subtitle: hasOverlappingSubtitle(tracks, range) ? 'ready' : 'none',
    candidate: deriveCandidate(latest, segment, timelineVoice, effectiveVoice),
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

/**
 * Card duration fallback chain (R2 RV2-01): timeline range → field → voice
 * length. The range wins so a generated but unapplied voice-over (which still
 * writes `segment.duration` for the AI video generators) does not make the
 * card claim a length the timeline does not have.
 */
export function resolveSegmentDuration(
  segment: ScriptSegment,
  range: SegmentTimeRange | null,
  latestVoice: MaterialItem | null,
): number | null {
  if (range && range.end > range.start) return range.end - range.start;
  if (typeof segment.duration === 'number' && segment.duration > 0) return segment.duration;
  const voiceLength = latestVoice?.sentenceSegments?.total_duration ?? latestVoice?.duration;
  return typeof voiceLength === 'number' && voiceLength > 0 ? voiceLength : null;
}
