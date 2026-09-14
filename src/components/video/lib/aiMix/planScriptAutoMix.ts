/**
 * planScriptAutoMix — arrange script voice-overs and matched videos.
 *
 * Pure and deterministic. The voice-over is the timing spine (AS-02): a
 * segment lasts exactly as long as its newest TTS audio and its videos are
 * trimmed or looped to cover that span, so segment k+1 starts in sync on
 * both lanes and neither lane has a hole for autoOrganize to close.
 *
 * "Newest" means the latest segment write (AS-01 / RV-07): the
 * `segment_assigned_at` stamp ScriptPanel writes on every match and TTS,
 * else the position in the library array. createdAt is never used (a
 * re-matched video is a copy that keeps the SOURCE material's createdAt),
 * and position alone is not enough: a match that reuses a library id is
 * replaced in place, so the newer match can sit before an older one.
 */

import type { MaterialItem } from '@/types';

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
  status: 'placed' | 'skipped-no-audio' | 'video-reused' | 'video-looped';
  reusedFromSegment?: number;
}

export interface ScriptAutoMixPlan {
  placements: AutoMixPlacement[];
  segments: AutoMixSegmentReport[];
  ignoredDuplicateMaterialIds: string[]; // older TTS / matches superseded
  totalDuration: number;
}

const MIN_CLIP_SECONDS = 0.1;
/** Cap on looped clips per segment, so bad durations cannot spin. */
const MAX_LOOPED_CLIPS = 20;

interface SegmentVersions {
  segmentId: string;
  segmentNumber: number;
  firstIndex: number;
  audios: MaterialItem[]; // library order; keepNewest picks the current one
  videosBySlot: Map<number, MaterialItem[]>;
}

interface Segment {
  segmentId: string;
  segmentNumber: number;
  audio: MaterialItem | null;
  videos: MaterialItem[]; // newest per video_index_in_segment, playable
}

const roundTime = (seconds: number) => Math.round(seconds * 1e6) / 1e6;
/** When ScriptPanel last assigned the material to its segment, if known. */
const assignedAt = (material: MaterialItem): number => {
  const stamp: unknown = material.metadata?.segment_assigned_at;
  return typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : -Infinity;
};
const isPlayable = (material: MaterialItem) =>
  (material.duration ?? 0) >= MIN_CLIP_SECONDS;

/** Group script audio / video by segment_id, keeping library order. */
function collectSegments(materials: readonly MaterialItem[]): SegmentVersions[] {
  const segments = new Map<string, SegmentVersions>();
  materials.forEach((material, index) => {
    const segmentId: unknown = material.metadata?.segment_id;
    const segmentNumber: unknown = material.metadata?.segment_number;
    if (material.type !== 'audio' && material.type !== 'video') return;
    if (typeof segmentId !== 'string' || segmentId === '') return;
    if (typeof segmentNumber !== 'number' || !Number.isFinite(segmentNumber)) return;
    const segment: SegmentVersions = segments.get(segmentId) ?? {
      segmentId, segmentNumber, firstIndex: index, audios: [], videosBySlot: new Map(),
    };
    segment.segmentNumber = segmentNumber; // the latest write is current
    if (material.type === 'audio') {
      segment.audios.push(material);
    } else {
      const rawSlot: unknown = material.metadata?.video_index_in_segment;
      const slot = typeof rawSlot === 'number' && Number.isFinite(rawSlot) ? rawSlot : 1;
      segment.videosBySlot.set(slot, (segment.videosBySlot.get(slot) ?? []).concat(material));
    }
    segments.set(segmentId, segment);
  });
  return Array.from(segments.values()).sort((a, b) =>
    a.segmentNumber - b.segmentNumber || a.firstIndex - b.firstIndex);
}

/** AS-01: keep the newest audio and the newest video per slot. */
function resolveSegment(versions: SegmentVersions, ignored: string[]): Segment {
  const keepNewest = (list: readonly MaterialItem[]): MaterialItem => {
    // Highest stamp wins; ties and unstamped (older) materials fall back to
    // library order, where the later entry is the more recent write.
    const newest = list.reduce((latest, material) =>
      (assignedAt(material) >= assignedAt(latest) ? material : latest));
    list.forEach((material) => {
      if (material.id !== newest.id) ignored.push(material.id);
    });
    return newest;
  };
  const audio = versions.audios.length > 0 ? keepNewest(versions.audios) : null;
  const videos = Array.from(versions.videosBySlot.entries())
    .sort(([slotA], [slotB]) => slotA - slotB)
    .map(([, list]) => keepNewest(list))
    .filter(isPlayable);
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

/** No segment has a voice-over: videos end to end at full length. */
function planVideoOnly(segments: readonly Segment[]) {
  const placements: AutoMixPlacement[] = [];
  let cursor = 0;
  segments.forEach(({ videos, segmentNumber }) => videos.forEach((video) => {
    const length = video.duration ?? 0;
    placements.push(place(video, 'video', cursor, length, segmentNumber));
    cursor += length;
  }));
  const reports = segments.map(({ segmentId, segmentNumber }):
    AutoMixSegmentReport => ({ segmentId, segmentNumber, status: 'placed' }));
  return { placements, reports, cursor };
}

/** The segment's own videos, else the nearest earlier, else later, ones. */
function pickVideoSource(segments: readonly Segment[], index: number) {
  const hasVideos = (segment: Segment) => segment.videos.length > 0;
  if (hasVideos(segments[index])) return segments[index];
  return segments.slice(0, index).reverse().filter(hasVideos)[0]
    ?? segments.slice(index + 1).filter(hasVideos)[0];
}

/** Fill [start, start + span) with the videos, trimming and looping. */
function coverWithVideos(
  videos: readonly MaterialItem[],
  start: number,
  span: number,
  segmentNumber: number,
) {
  const placements: AutoMixPlacement[] = [];
  let remaining = span;
  let looped = false;
  for (let index = 0; videos.length > 0 && remaining >= MIN_CLIP_SECONDS; index += 1) {
    if (index >= videos.length + MAX_LOOPED_CLIPS) break;
    looped = looped || index >= videos.length;
    const video = videos[index % videos.length];
    const take = Math.min(video.duration ?? 0, remaining);
    placements.push(place(video, 'video', start + span - remaining, take, segmentNumber));
    remaining -= take;
  }
  return { placements, looped };
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
    const span = audio.duration ?? 0;
    const source = pickVideoSource(segments, index);
    const cover = coverWithVideos(source?.videos ?? [], cursor, span, segmentNumber);
    placements.push(place(audio, 'audio', cursor, span, segmentNumber), ...cover.placements);
    if (source && source !== segment) {
      const reusedFromSegment = source.segmentNumber;
      reports.push({ segmentId, segmentNumber, status: 'video-reused', reusedFromSegment });
    } else {
      const status = cover.looped ? 'video-looped' : 'placed';
      reports.push({ segmentId, segmentNumber, status });
    }
    cursor += span;
  });
  return { placements, reports, cursor };
}

export function planScriptAutoMix(
  materials: readonly MaterialItem[],
): ScriptAutoMixPlan {
  const ignoredDuplicateMaterialIds: string[] = [];
  const segments = collectSegments(materials)
    .map((versions) => resolveSegment(versions, ignoredDuplicateMaterialIds));
  const hasVoiceOver = segments.some((segment) => segment.audio !== null);
  const { placements, reports, cursor } = hasVoiceOver
    ? planVoiceOver(segments)
    : planVideoOnly(segments);
  return {
    placements,
    segments: reports,
    ignoredDuplicateMaterialIds,
    totalDuration: roundTime(cursor),
  };
}
