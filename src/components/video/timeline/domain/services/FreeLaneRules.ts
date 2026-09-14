/**
 * FreeLaneRules — hand edits on lanes that are never packed (subtitles).
 *
 * A caption trimmed over or dropped onto its neighbour produced two captions
 * on screen at once, in preview and in export, and every later agent edit
 * carried an overlap warning it could not fix (TL3-04). Hand edits are
 * clamped or fitted instead. Overlaps that already exist are left alone: the
 * rules never push a clip, they only stop an edit from creating a new overlap.
 *
 * Pure: no store, React or DOM access.
 */

import { MIN_CLIP_DURATION_SECONDS } from '../value-objects/Duration';
import { TIME_EPSILON } from './ClipTimeMapping';

export interface LanePeer {
  id: string;
  startTime: number;
  duration: number;
}

interface Interval {
  start: number;
  end: number;
}

/** The clips of a domain track as plain peers (magnetic or free lanes alike). */
export function lanePeersOf(track: {
  items: ReadonlyArray<{ id: string; startTime: { value: number }; duration: { value: number } }>;
}): LanePeer[] {
  return track.items.map((item) => ({
    id: item.id,
    startTime: item.startTime.value,
    duration: item.duration.value,
  }));
}

function othersOf(peers: readonly LanePeer[], itemId: string): LanePeer[] {
  return peers
    .filter((peer) => peer.id !== itemId)
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Clamp a trim edge: the start edge stays at or after the end of the caption
 * before it, the end edge at or before the start of the caption after it, and
 * at least MIN_CLIP_DURATION_SECONDS always remains.
 */
export function clampTrimEdge(
  peers: readonly LanePeer[],
  itemId: string,
  edge: 'start' | 'end',
  position: number,
  current: { startTime: number; duration: number },
): number {
  const others = othersOf(peers, itemId);
  const currentEnd = current.startTime + current.duration;
  if (edge === 'start') {
    const previousEnd = others
      .filter((peer) => peer.startTime < current.startTime - TIME_EPSILON)
      .reduce((max, peer) => Math.max(max, peer.startTime + peer.duration), 0);
    // An existing overlap would put the bound past the edge; never push it.
    const lower = Math.min(previousEnd, current.startTime);
    const upper = currentEnd - MIN_CLIP_DURATION_SECONDS;
    return Math.min(Math.max(position, lower, 0), upper);
  }
  const nextStart = others
    .filter((peer) => peer.startTime > current.startTime + TIME_EPSILON)
    .reduce((min, peer) => Math.min(min, peer.startTime), Number.POSITIVE_INFINITY);
  const upper = Math.max(nextStart, currentEnd);
  const lower = current.startTime + MIN_CLIP_DURATION_SECONDS;
  return Math.max(Math.min(position, upper), lower);
}

/** Occupied spans of the other captions, overlapping ones merged. */
function occupiedIntervals(others: readonly LanePeer[]): Interval[] {
  const merged: Interval[] = [];
  for (const peer of others) {
    const span = { start: peer.startTime, end: peer.startTime + peer.duration };
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + TIME_EPSILON) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/** Free spans between the occupied ones; the last one is unbounded. */
function freeIntervals(occupied: readonly Interval[]): Interval[] {
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const span of occupied) {
    if (span.start > cursor + TIME_EPSILON) gaps.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  gaps.push({ start: cursor, end: Number.POSITIVE_INFINITY });
  return gaps;
}

/**
 * Where a caption moved to `start` may land: `start` itself when the span is
 * free; otherwise the position closest to `start` inside the nearest gap that
 * holds the whole caption. Null when no gap can hold it.
 */
export function fitMove(
  peers: readonly LanePeer[],
  itemId: string,
  start: number,
  duration: number,
): number | null {
  if (!Number.isFinite(start) || !(duration > 0)) return null;
  const others = othersOf(peers, itemId);
  const requested = Math.max(0, start);
  const collides = others.some(
    (peer) =>
      requested < peer.startTime + peer.duration - TIME_EPSILON &&
      peer.startTime < requested + duration - TIME_EPSILON,
  );
  if (!collides) return requested;

  let best: number | null = null;
  for (const gap of freeIntervals(occupiedIntervals(others))) {
    if (gap.end - gap.start + TIME_EPSILON < duration) continue;
    const candidate = Math.min(Math.max(requested, gap.start), gap.end - duration);
    if (best === null || Math.abs(candidate - requested) < Math.abs(best - requested)) {
      best = candidate;
    }
  }
  return best;
}
