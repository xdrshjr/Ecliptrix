/**
 * mergeAiMixTimeline — fold an AI auto-edit plan into the current timeline.
 *
 * Pure (no React, no store). Only tracks the plan targets are replaced; subtitles, unused
 * audio tracks and extra user video tracks come back untouched and never receive copies of
 * AI clips (AM-01 / AM-02). Each imported audio track keeps its own lane (AM-03).
 */

import type { TimelineData, TimelineItemData, TrackData } from '@/components/video/timeline/domain';
import type { TimelineState } from '@/types';

export const MIN_AI_CLIP_SECONDS = 0.1;

/** Clips touching within a millisecond do not count as overlapping. */
const OVERLAP_TOLERANCE_SECONDS = 1e-3;
const AUDIO_TRACK_NUMBER_PATTERN = /audio-track-(\d+)$/;

export interface AiMixMergeInput {
  current: TimelineData; // useTimelineStore.getState().exportToData()
  imported: TimelineState; // importResult.importedData.timelineState
  knownMaterialIds: ReadonlySet<string>; // ids in the material library
}

export type AiMixDropReason = 'unknown-material' | 'too-short';

export interface AiMixMergeResult {
  timeline: TimelineData;
  replacedTrackIds: string[]; // existing tracks whose items were replaced
  createdTrackIds: string[]; // tracks created to hold AI clips
  skippedLockedTrackIds: string[]; // locked targets left untouched
  droppedItems: Array<{ itemId: string; reason: AiMixDropReason }>;
  renamedItemIds: Record<string, string>; // original id → collision-free id
}

/** The part of the timeline an AI track feeds. */
export type AiMixLane = 'video' | 'image' | 'audio';

interface TrackRoute {
  track: TrackData;
  isCreated: boolean;
  incoming: TimelineItemData[];
}

export function getAiMixLane(track: Pick<TrackData, 'id' | 'type'>): AiMixLane | null {
  if (track.id.startsWith('image-track')) return 'image';
  return track.type === 'subtitle' ? null : track.type;
}

/**
 * R1: the existing track an AI lane lands on; undefined means the merge creates one.
 * `audioNumber` is the 1-based n of `audio-track-n`.
 */
export function findAiMixTargetTrack(
  tracks: readonly TrackData[], lane: AiMixLane, audioNumber = 1,
): TrackData | undefined {
  const preferredId = lane === 'audio' ? `audio-track-${audioNumber}` : `${lane}-track-1`;
  const inLane = (track: TrackData) => getAiMixLane(track) === lane;
  const preferred = tracks.find((track) => track.id === preferredId && inLane(track));
  const ordered = tracks.filter(inLane).sort((a, b) => a.order - b.order);
  return preferred ?? ordered[lane === 'audio' ? audioNumber - 1 : 0];
}

function createLaneTrack(
  source: TrackData, lane: AiMixLane, audioNumber: number, tracks: readonly TrackData[],
): TrackData {
  const id = lane === 'audio' ? `audio-track-${audioNumber}` : `${lane}-track-1`;
  const order = tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1;
  const type = lane === 'audio' ? 'audio' : 'video';
  return { ...source, id, type, order, volume: 100, isLocked: false, items: [] };
}

const audioNumberOf = (track: Pick<TrackData, 'id'>): number => {
  const match = AUDIO_TRACK_NUMBER_PATTERN.exec(track.id);
  return match ? Math.max(1, Number(match[1])) : 1;
};

/**
 * R3: whether `track` belongs to another AI audio lane — already claimed by
 * one, or named `audio-track-m` for an imported m. Without this the positional
 * fallback could route two AI audio lanes onto one track (AM-03).
 */
function isOwnedByOtherAudioLane(
  track: TrackData, audioNumber: number,
  claimedBy: ReadonlyMap<string, number>, importedNumbers: ReadonlySet<number>,
): boolean {
  const claimant = claimedBy.get(track.id);
  if (claimant !== undefined) return claimant !== audioNumber;
  const match = AUDIO_TRACK_NUMBER_PATTERN.exec(track.id);
  const idNumber = match ? Number(match[1]) : audioNumber;
  return idNumber !== audioNumber && importedNumbers.has(idNumber);
}

/** R1 / R3: decide which track each non-empty imported track writes to. */
function routeImportedTracks(current: readonly TrackData[], imported: readonly TrackData[]) {
  const working = [...current];
  const routes = new Map<string, TrackRoute>();
  const skipped = new Set<string>();
  const sources = imported.filter((source) => getAiMixLane(source) && source.items?.length);
  const importedAudioNumbers = new Set(sources
    .filter((source) => getAiMixLane(source) === 'audio')
    .map(audioNumberOf));
  const claimedBy = new Map<string, number>(); // audio track id → AI lane number
  for (const source of sources) {
    const lane = getAiMixLane(source) as AiMixLane;
    const audioNumber = lane === 'audio' ? audioNumberOf(source) : 1;
    let existing = findAiMixTargetTrack(working, lane, audioNumber);
    if (existing && lane === 'audio'
      && isOwnedByOtherAudioLane(existing, audioNumber, claimedBy, importedAudioNumbers)) {
      existing = undefined;
    }
    if (existing?.isLocked) {
      skipped.add(existing.id);
      continue;
    }
    const track = existing ?? createLaneTrack(source, lane, audioNumber, working);
    if (!existing) working.push(track);
    if (lane === 'audio') claimedBy.set(track.id, audioNumber);
    const route: TrackRoute = routes.get(track.id)
      ?? { track, isCreated: current.indexOf(track) === -1, incoming: [] };
    route.incoming.push(...source.items);
    routes.set(track.id, route);
  }
  return { routes: Array.from(routes.values()), skippedLockedTrackIds: Array.from(skipped) };
}

/** R4: drop unusable clips and pin the rest to the target track. */
function normaliseIncoming(
  route: TrackRoute, known: ReadonlySet<string>, dropped: AiMixMergeResult['droppedItems'],
): TimelineItemData[] {
  const kept: TimelineItemData[] = [];
  for (const item of route.incoming) {
    const volume = item.volume ?? 1;
    if (item.materialId && !known.has(item.materialId)) {
      dropped.push({ itemId: item.id, reason: 'unknown-material' });
    } else if (!(item.duration >= MIN_AI_CLIP_SECONDS)) {
      dropped.push({ itemId: item.id, reason: 'too-short' });
    } else {
      kept.push({
        ...item,
        trackId: route.track.id,
        startTime: Number.isFinite(item.startTime) ? Math.max(0, item.startTime) : 0,
        volume: Number.isFinite(volume) ? Math.min(2, Math.max(0, volume)) : 1,
      });
    }
  }
  return kept;
}

/** R5: rename clips whose id is already used on the timeline. */
function assignUniqueIds(
  items: readonly TimelineItemData[], takenIds: Set<string>, renamed: Record<string, string>,
): TimelineItemData[] {
  return items.map((item) => {
    let id = item.id;
    for (let suffix = 2; takenIds.has(id); suffix += 1) id = `${item.id}-${suffix}`;
    takenIds.add(id);
    if (id === item.id) return item;
    renamed[item.id] = id;
    return { ...item, id };
  });
}

/** R6: a clip starting inside its predecessor moves to that clip's end. */
function removeOverlaps(items: readonly TimelineItemData[]): TimelineItemData[] {
  let previousEnd = 0;
  return [...items].sort((a, b) => a.startTime - b.startTime).map((item) => {
    const overlaps = item.startTime < previousEnd - OVERLAP_TOLERANCE_SECONDS;
    const startTime = overlaps ? previousEnd : item.startTime;
    previousEnd = startTime + item.duration;
    return overlaps ? { ...item, startTime } : item;
  });
}

/** R7: total duration spans every track; view settings are kept from `current`. */
function buildTimeline(current: TimelineData, tracks: TrackData[]): TimelineData {
  const ends = tracks.reduce<number[]>(
    (all, track) => all.concat(track.items.map((item) => item.startTime + item.duration)),
    [],
  );
  const { zoomLevel, playbackRate, snapToGrid, gridSize, scrollLeft } = current;
  return {
    currentTime: 0, totalDuration: Math.max(0, ...ends), zoomLevel, playbackRate,
    isPlaying: false, snapToGrid, gridSize, scrollLeft, tracks,
  };
}

export function mergeAiMixTimeline(input: AiMixMergeInput): AiMixMergeResult {
  const { current, knownMaterialIds } = input;
  const { routes, skippedLockedTrackIds } = routeImportedTracks(
    current.tracks,
    input.imported.tracks,
  );
  const droppedItems: AiMixMergeResult['droppedItems'] = [];
  // A lane whose AI clips were all dropped keeps the user's content.
  const filled = routes
    .map((route) => ({ route, items: normaliseIncoming(route, knownMaterialIds, droppedItems) }))
    .filter((entry) => entry.items.length > 0);
  const targetIds = filled.map(({ route }) => route.track.id);
  const takenIds = new Set(current.tracks
    .filter((track) => targetIds.indexOf(track.id) === -1)
    .reduce<string[]>((ids, track) => ids.concat(track.items.map((item) => item.id)), []));
  const renamedItemIds: Record<string, string> = {};
  const itemsByTrack = new Map(filled.map(({ route, items }) => [
    route.track.id,
    removeOverlaps(assignUniqueIds(items, takenIds, renamedItemIds)),
  ] as const));
  const withItems = (track: TrackData): TrackData => {
    const items = itemsByTrack.get(track.id);
    return items ? { ...track, items } : track;
  };
  const created = filled.filter(({ route }) => route.isCreated).map(({ route }) => route.track);
  const createdTrackIds = created.map((track) => track.id);
  return {
    timeline: buildTimeline(current, current.tracks.map(withItems).concat(created.map(withItems))),
    replacedTrackIds: targetIds.filter((id) => createdTrackIds.indexOf(id) === -1),
    createdTrackIds,
    skippedLockedTrackIds,
    droppedItems,
    renamedItemIds,
  };
}
