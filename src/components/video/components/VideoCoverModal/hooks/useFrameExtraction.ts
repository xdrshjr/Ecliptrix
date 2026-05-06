'use client';

import { useCallback, useMemo, useRef } from 'react';

import { extractVideoFrameAt } from '@/components/video/utils/extractVideoThumbnail';
import type { MaterialItem, TimelineItem } from '@/types';

/**
 * One slice of the virtual timeline — a video clip the user can scrub into.
 * ``virtualStart`` / ``virtualEnd`` are seconds since the start of the
 * concatenated virtual timeline; ``clipOffset`` is seconds into the source
 * material that ``virtualStart`` corresponds to.
 */
export interface VirtualSegment {
  virtualStart: number;
  virtualEnd: number;
  material: MaterialItem;
  clipOffset: number;
}

export interface VirtualSegmentsResult {
  segments: VirtualSegment[];
  totalVirtualDurationMs: number;
}

export interface UseFrameExtractionResult {
  totalVirtualDurationSec: number;
  extractAt: (virtualTimeSec: number) => Promise<string | null>;
}

/**
 * Build the virtual timeline by concatenating every video timeline item in
 * start-time order. Empty gaps and audio-only items are skipped — see
 * spec §2.2.C and the corresponding unit tests.
 */
export function buildVirtualSegments(
  materials: MaterialItem[],
  timelineItems: TimelineItem[],
): VirtualSegmentsResult {
  const materialById = new Map<string, MaterialItem>();
  for (const m of materials) {
    materialById.set(m.id, m);
  }

  const videoItems = timelineItems
    .filter((it) => it.type === 'video' && (it.materialId || it.thumbnailUrl))
    .slice()
    .sort((a, b) => a.startTime - b.startTime);

  const segments: VirtualSegment[] = [];
  let cumulative = 0;

  for (const item of videoItems) {
    const material = item.materialId ? materialById.get(item.materialId) : undefined;
    if (!material) continue;
    const duration = Math.max(0, item.duration);
    if (duration <= 0) continue;
    const clipOffset = item.clipStart ?? 0;
    segments.push({
      virtualStart: cumulative,
      virtualEnd: cumulative + duration,
      material,
      clipOffset,
    });
    cumulative += duration;
  }

  return {
    segments,
    totalVirtualDurationMs: Math.round(cumulative * 1000),
  };
}

function mapVirtualTimeToClip(
  virtualTimeSec: number,
  segments: VirtualSegment[],
): { material: MaterialItem; localTime: number } | null {
  if (segments.length === 0) return null;
  const clamped = Math.max(0, virtualTimeSec);
  for (const seg of segments) {
    if (clamped >= seg.virtualStart && clamped < seg.virtualEnd) {
      return {
        material: seg.material,
        localTime: seg.clipOffset + (clamped - seg.virtualStart),
      };
    }
  }
  // Past the end → snap to the last frame of the final segment
  const last = segments[segments.length - 1];
  return {
    material: last.material,
    localTime: last.clipOffset + (last.virtualEnd - last.virtualStart),
  };
}

/**
 * Hook used by VideoCoverModal to drive the frame scrubber.
 *
 * The LRU cache keeps the 8 most recently extracted frames keyed on
 * ``materialId|localTimeMs`` to keep the scrubber smooth as the user drags
 * across already-visited points.
 */
export function useFrameExtraction(
  materials: MaterialItem[],
  timelineItems: TimelineItem[],
): UseFrameExtractionResult {
  const { segments, totalVirtualDurationMs } = useMemo(
    () => buildVirtualSegments(materials, timelineItems),
    [materials, timelineItems],
  );

  // Manual LRU(8). Map preserves insertion order so the oldest entry is
  // always the first key.
  const cacheRef = useRef<Map<string, string>>(new Map());

  const extractAt = useCallback(
    async (virtualTimeSec: number): Promise<string | null> => {
      const mapped = mapVirtualTimeToClip(virtualTimeSec, segments);
      if (!mapped) return null;

      const cacheKey = `${mapped.material.id}|${Math.round(mapped.localTime * 1000)}`;
      const cache = cacheRef.current;
      const cached = cache.get(cacheKey);
      if (cached) {
        // Touch — move to MRU end
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        return cached;
      }

      const url = mapped.material.url;
      if (!url) return null;
      const dataUrl = await extractVideoFrameAt(url, mapped.localTime);
      if (!dataUrl) return null;

      cache.set(cacheKey, dataUrl);
      while (cache.size > 8) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return dataUrl;
    },
    [segments],
  );

  return {
    totalVirtualDurationSec: totalVirtualDurationMs / 1000,
    extractAt,
  };
}
