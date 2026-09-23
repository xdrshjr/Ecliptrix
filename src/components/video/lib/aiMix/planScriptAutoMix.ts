/**
 * planScriptAutoMix — arrange script voice-overs and matched videos.
 *
 * Pure and deterministic. The voice-over is the timing spine (AS-02): a
 * segment lasts exactly as long as its current TTS audio and its videos are
 * trimmed or looped to cover that span without a hole (AS2-03), so segment
 * k+1 starts in sync on both lanes and the layout already is what
 * autoOrganize would produce (S8).
 *
 * Which materials count:
 *  · With the current script (`options.segments`) the script decides segment
 *    order, numbering and membership. Materials of segments no longer in it,
 *    and voice-overs whose text hash no longer matches their segment (RV-07),
 *    are orphaned (AS2-02). A segment's videos are the ones it lists (AS2-01).
 *  · Without a script (legacy data) materials group by `segment_id` in
 *    `segment_number` order, and only the latest match batch of a segment
 *    counts, so slots of an earlier, larger match do not linger (AS2-01).
 *
 * "Newest" means the latest segment write: the `segment_assigned_at` stamp
 * ScriptPanel writes on every match and TTS, else the position in the library
 * array. createdAt is never used (a re-matched video is a copy that keeps the
 * SOURCE material's createdAt).
 */

import type { MaterialItem } from '@/types';
import {
  coverSpanWithSources,
  MIN_CLIP_SECONDS,
  roundTime,
} from '@/components/video/lib/segments/fillSpanWithMaterial';

export interface AutoMixPlacement {
  material: MaterialItem;
  lane: 'audio' | 'video';
  startTime: number;
  duration: number;
  clipStart: number;
  clipEnd: number;
  segmentNumber: number;
}

export interface AutoMixSegmentReport {
  segmentNumber: number;
  segmentId: string;
  /** 'video-short' wins over the others: the video lane has a hole under the voice-over. */
  status: 'placed' | 'skipped-no-audio' | 'skipped-no-video' | 'video-reused' | 'video-looped' | 'video-short';
  reusedFromSegment?: number;
}

/** The current script, as far as the planner needs it. */
export interface ScriptSegmentRef {
  id: string;
  /** Videos matched to the segment, in slot order. */
  videos?: ReadonlyArray<Pick<MaterialItem, 'id'>>;
  /** segmentTextHash of the text the segment's voice-over should say. */
  textHash?: string;
}

export interface PlanScriptAutoMixOptions {
  /** The current script; omitted → legacy grouping by segment_number. */
  segments?: readonly ScriptSegmentRef[];
}

export interface ScriptAutoMixPlan {
  placements: AutoMixPlacement[];
  segments: AutoMixSegmentReport[];
  ignoredDuplicateMaterialIds: string[]; // older TTS / matches superseded
  orphanedMaterialIds: string[]; // removed segments' materials and stale voice-overs
  totalDuration: number;
}

interface SegmentVersions {
  segmentId: string;
  segmentNumber: number;
  firstIndex: number;
  audios: MaterialItem[]; // library order; keepNewest picks the current one
  videos: MaterialItem[]; // library order
  listedVideoIds?: readonly string[]; // the script's own match, when known
}

interface Segment {
  segmentId: string;
  segmentNumber: number;
  audio: MaterialItem | null;
  videos: MaterialItem[]; // current match, playable, slot order
}

interface Coverage {
  placements: AutoMixPlacement[];
  looped: boolean;
  covered: boolean;
}

/** When ScriptPanel last assigned the material to its segment, if known. */
const assignedAt = (material: MaterialItem): number => {
  const stamp: unknown = material.metadata?.segment_assigned_at;
  return typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : -Infinity;
};
const slotOf = (material: MaterialItem): number => {
  const slot: unknown = material.metadata?.video_index_in_segment;
  return typeof slot === 'number' && Number.isFinite(slot) ? slot : 1;
};
const isPlayable = (material: MaterialItem) =>
  (material.duration ?? 0) >= MIN_CLIP_SECONDS;

/** The script segment a TTS audio or matched video was written for. */
function scriptSegmentIdOf(material: MaterialItem): string | null {
  if (material.type !== 'audio' && material.type !== 'video') return null;
  const segmentId: unknown = material.metadata?.segment_id;
  return typeof segmentId === 'string' && segmentId !== '' ? segmentId : null;
}

function addVersion(segment: SegmentVersions, material: MaterialItem): void {
  (material.type === 'audio' ? segment.audios : segment.videos).push(material);
}

/** Legacy: group script audio / video by segment_id, keeping library order. */
function collectLegacySegments(materials: readonly MaterialItem[]): SegmentVersions[] {
  const segments = new Map<string, SegmentVersions>();
  materials.forEach((material, index) => {
    const segmentId = scriptSegmentIdOf(material);
    const segmentNumber: unknown = material.metadata?.segment_number;
    if (!segmentId) return;
    if (typeof segmentNumber !== 'number' || !Number.isFinite(segmentNumber)) return;
    const segment: SegmentVersions = segments.get(segmentId) ?? {
      segmentId, segmentNumber, firstIndex: index, audios: [], videos: [],
    };
    segment.segmentNumber = segmentNumber; // the latest write is current
    addVersion(segment, material);
    segments.set(segmentId, segment);
  });
  return Array.from(segments.values()).sort((a, b) =>
    a.segmentNumber - b.segmentNumber || a.firstIndex - b.firstIndex);
}

/** RV-07: a voice-over stamped with a different text than the segment's current one. */
function isStaleVoiceOver(material: MaterialItem, ref: ScriptSegmentRef): boolean {
  const stamped: unknown = material.metadata?.segment_text_hash;
  // Voice-overs written before the stamp existed carry no hash and still count.
  return material.type === 'audio'
    && typeof ref.textHash === 'string'
    && typeof stamped === 'string'
    && stamped !== ref.textHash;
}

interface CollectedSegments {
  versions: SegmentVersions[];
  /** A voice-over was dropped as stale, so the script is meant to be narrated. */
  hasStaleVoiceOver: boolean;
}

/** AS2-02: the current script decides segment order, numbers and membership. */
function collectScriptSegments(
  materials: readonly MaterialItem[],
  refs: readonly ScriptSegmentRef[],
  orphaned: string[],
): CollectedSegments {
  let hasStaleVoiceOver = false;
  const byId = new Map<string, { ref: ScriptSegmentRef; versions: SegmentVersions }>();
  refs.forEach((ref) => {
    if (byId.has(ref.id)) return; // a duplicated id keeps its first position
    const position = byId.size;
    byId.set(ref.id, {
      ref,
      versions: {
        segmentId: ref.id,
        segmentNumber: position + 1,
        firstIndex: position,
        audios: [],
        videos: [],
        listedVideoIds: ref.videos?.map((video) => video.id),
      },
    });
  });
  materials.forEach((material) => {
    const segmentId = scriptSegmentIdOf(material);
    if (!segmentId) return;
    const entry = byId.get(segmentId);
    const isStale = !!entry && isStaleVoiceOver(material, entry.ref);
    if (!entry || isStale) {
      orphaned.push(material.id);
      hasStaleVoiceOver = hasStaleVoiceOver || isStale;
      return;
    }
    addVersion(entry.versions, material);
  });
  return { versions: Array.from(byId.values(), (entry) => entry.versions), hasStaleVoiceOver };
}

/** Highest stamp wins; ties and unstamped (older) materials fall back to library order. */
function keepNewest(list: readonly MaterialItem[], ignored: string[]): MaterialItem {
  const newest = list.reduce((latest, material) =>
    (assignedAt(material) >= assignedAt(latest) ? material : latest));
  list.forEach((material) => {
    if (material.id !== newest.id) ignored.push(material.id);
  });
  return newest;
}

/** The newest video per video_index_in_segment, in slot order. */
function newestPerSlot(videos: readonly MaterialItem[], ignored: string[]): MaterialItem[] {
  const bySlot = new Map<number, MaterialItem[]>();
  videos.forEach((video) => {
    bySlot.set(slotOf(video), (bySlot.get(slotOf(video)) ?? []).concat(video));
  });
  return Array.from(bySlot.entries())
    .sort(([slotA], [slotB]) => slotA - slotB)
    .map(([, list]) => keepNewest(list, ignored));
}

/**
 * AS2-01: a re-match replaces the whole previous match. The script's own list
 * wins when known (looked up by id: a library copy re-matched to a later
 * segment is still the video this segment shows); otherwise only the latest
 * stamped batch counts.
 */
function pickSegmentVideos(
  versions: SegmentVersions,
  library: ReadonlyMap<string, MaterialItem>,
  ignored: string[],
): MaterialItem[] {
  const listed = versions.listedVideoIds;
  if (listed && listed.length > 0) {
    const chosen = listed
      .map((id) => library.get(id))
      .filter((material): material is MaterialItem => material?.type === 'video');
    const chosenIds = new Set(chosen.map((video) => video.id));
    versions.videos.forEach((video) => {
      if (!chosenIds.has(video.id)) ignored.push(video.id);
    });
    return chosen;
  }
  const latest = versions.videos.reduce((max, video) => Math.max(max, assignedAt(video)), -Infinity);
  if (!Number.isFinite(latest)) return newestPerSlot(versions.videos, ignored);
  versions.videos.forEach((video) => {
    if (assignedAt(video) !== latest) ignored.push(video.id);
  });
  return newestPerSlot(versions.videos.filter((video) => assignedAt(video) === latest), ignored);
}

function resolveSegment(
  versions: SegmentVersions,
  library: ReadonlyMap<string, MaterialItem>,
  ignored: string[],
): Segment {
  const audio = versions.audios.length > 0 ? keepNewest(versions.audios, ignored) : null;
  const videos = pickSegmentVideos(versions, library, ignored).filter(isPlayable);
  const { segmentId, segmentNumber } = versions;
  return { segmentId, segmentNumber, audio, videos };
}

function place(
  material: MaterialItem,
  lane: AutoMixPlacement['lane'],
  startTime: number,
  duration: number,
  segmentNumber: number,
): AutoMixPlacement {
  const length = roundTime(duration);
  return {
    material, lane, startTime: roundTime(startTime), duration: length,
    clipStart: 0, clipEnd: length, segmentNumber,
  };
}

/** No segment has a voice-over: videos end to end at full length; a segment without videos is skipped. */
function planVideoOnly(segments: readonly Segment[]) {
  const placements: AutoMixPlacement[] = [];
  let cursor = 0;
  segments.forEach(({ videos, segmentNumber }) => videos.forEach((video) => {
    const length = roundTime(video.duration ?? 0);
    placements.push(place(video, 'video', cursor, length, segmentNumber));
    cursor = roundTime(cursor + length);
  }));
  const reports = segments.map(({ segmentId, segmentNumber, videos }): AutoMixSegmentReport => ({
    segmentId, segmentNumber, status: videos.length > 0 ? 'placed' : 'skipped-no-video',
  }));
  return { placements, reports, cursor };
}

/** The segment's own videos, else the nearest earlier, else later, ones. */
function pickVideoSource(segments: readonly Segment[], index: number) {
  const hasVideos = (segment: Segment) => segment.videos.length > 0;
  if (hasVideos(segments[index])) return segments[index];
  return segments.slice(0, index).reverse().filter(hasVideos)[0]
    ?? segments.slice(index + 1).filter(hasVideos)[0];
}

/**
 * Fill [start, start + span) with the videos, trimming and looping, without a
 * hole (AS2-03). The coverage rules are shared with the segment commands
 * (`coverSpanWithSources`), so both paths fill a segment identically.
 */
function coverWithVideos(
  videos: readonly MaterialItem[],
  start: number,
  span: number,
  segmentNumber: number,
): Coverage {
  const coverage = coverSpanWithSources(videos, start, span);
  const placements = coverage.clips.map((clip): AutoMixPlacement => ({
    ...clip, lane: 'video', segmentNumber,
  }));
  return { placements, looped: coverage.looped, covered: coverage.covered };
}

function coverageReport(
  segment: Segment,
  source: Segment | undefined,
  coverage: Coverage,
): AutoMixSegmentReport {
  const { segmentId, segmentNumber } = segment;
  if (!coverage.covered) return { segmentId, segmentNumber, status: 'video-short' };
  if (source && source !== segment) {
    return {
      segmentId, segmentNumber, status: 'video-reused', reusedFromSegment: source.segmentNumber,
    };
  }
  return { segmentId, segmentNumber, status: coverage.looped ? 'video-looped' : 'placed' };
}

/** AS-02: the voice-over sets each segment's span; no audio → skipped. */
function planVoiceOver(segments: readonly Segment[]) {
  const placements: AutoMixPlacement[] = [];
  const reports: AutoMixSegmentReport[] = [];
  let cursor = 0;
  segments.forEach((segment, index) => {
    const { segmentId, segmentNumber, audio } = segment;
    if (!audio || !isPlayable(audio)) {
      reports.push({ segmentId, segmentNumber, status: 'skipped-no-audio' });
      return;
    }
    const span = roundTime(audio.duration ?? 0);
    const source = pickVideoSource(segments, index);
    const coverage = coverWithVideos(source?.videos ?? [], cursor, span, segmentNumber);
    placements.push(place(audio, 'audio', cursor, span, segmentNumber), ...coverage.placements);
    reports.push(coverageReport(segment, source, coverage));
    cursor = roundTime(cursor + span);
  });
  return { placements, reports, cursor };
}

/**
 * Ids a current segment uses. An AI match lists library videos without
 * re-tagging them, so a video can carry another (or a deleted) segment's id
 * while still being shown; it must not be reported as ignored or orphaned.
 */
function chosenMaterialIds(segments: readonly Segment[]): ReadonlySet<string> {
  const ids = new Set<string>();
  segments.forEach(({ audio, videos }) => {
    if (audio) ids.add(audio.id);
    videos.forEach((video) => ids.add(video.id));
  });
  return ids;
}

export function planScriptAutoMix(
  materials: readonly MaterialItem[],
  options: PlanScriptAutoMixOptions = {},
): ScriptAutoMixPlan {
  const ignoredDuplicateMaterialIds: string[] = [];
  const orphanedMaterialIds: string[] = [];
  const collected: CollectedSegments = options.segments
    ? collectScriptSegments(materials, options.segments, orphanedMaterialIds)
    : { versions: collectLegacySegments(materials), hasStaleVoiceOver: false };
  const library = new Map(materials.map((material) => [material.id, material] as const));
  const segments = collected.versions
    .map((segment) => resolveSegment(segment, library, ignoredDuplicateMaterialIds));
  // Stale voice-overs still mean "narrated": laying the videos end to end
  // instead would quietly drop the narration the user is waiting to regenerate.
  const hasVoiceOver = collected.hasStaleVoiceOver
    || segments.some((segment) => segment.audio !== null);
  const { placements, reports, cursor } = hasVoiceOver
    ? planVoiceOver(segments)
    : planVideoOnly(segments);
  const chosen = chosenMaterialIds(segments);
  const isUnused = (id: string) => !chosen.has(id);
  return {
    placements,
    segments: reports,
    ignoredDuplicateMaterialIds: ignoredDuplicateMaterialIds.filter(isUnused),
    orphanedMaterialIds: orphanedMaterialIds.filter(isUnused),
    totalDuration: roundTime(cursor),
  };
}
