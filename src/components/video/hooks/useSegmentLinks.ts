'use client';

/**
 * useSegmentLinks — memoised segment derivation for the workbench (spec
 * §3.4.2). Called ONCE, in VideoEditingInterface; everything else reads the
 * result through SegmentLinksContext (RV-01).
 *
 * Performance contract (R4): the heavy derivation depends only on the
 * `segments`, `materials` and timeline `tracks` references — never on the
 * playhead. The playing segment is a separate, cheap lookup whose string
 * result only changes when playback crosses a segment boundary.
 */

import { useMemo } from 'react';
import type { MaterialItem, ScriptSegment } from '@/types';
import { useTimelineStore } from '../timeline/store';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import {
  buildMaterialsById,
  buildSegmentIndex,
  computeSegmentTimeRange,
  deriveSegmentStatus,
  findLatestVoiceMaterial,
  findPlayingSegmentId,
  resolveItemSegmentId,
  type LinkableTrack,
  type SegmentStatus,
  type SegmentTimeRange,
} from '../lib/segments/segmentLinks';
import type { SegmentLinksValue } from '../lib/segments/SegmentLinksContext';

export interface UseSegmentLinksInput {
  segments: readonly ScriptSegment[];
  materials: readonly MaterialItem[];
  /** The panel is showing the placeholder script: no chips, no audition. */
  isPlaceholderScript: boolean;
  /** Live playhead (seconds); only feeds the playing-segment lookup. */
  currentTime: number;
}

export interface UseSegmentLinksReturn {
  links: SegmentLinksValue;
  playingSegmentId: string | null;
}

interface StaticLinks {
  segmentIndex: SegmentLinksValue['segmentIndex'];
  itemSegmentMap: Map<string, string>;
  materialSegmentMap: Map<string, string>;
  segmentRanges: Map<string, SegmentTimeRange>;
  latestVoiceById: Map<string, MaterialItem>;
}

function deriveStaticLinks(
  segments: readonly ScriptSegment[],
  materials: readonly MaterialItem[],
  tracks: readonly LinkableTrack[],
): StaticLinks {
  const segmentIndex = buildSegmentIndex(segments);
  const materialsById = buildMaterialsById(materials);
  const itemSegmentMap = new Map<string, string>();
  tracks.forEach((track) => track.items.forEach((item) => {
    const segmentId = resolveItemSegmentId(item, materialsById);
    if (segmentId && segmentIndex.has(segmentId)) itemSegmentMap.set(item.id, segmentId);
  }));
  const materialSegmentMap = new Map<string, string>();
  materials.forEach((material) => {
    const segmentId = material.metadata?.segment_id ?? material.metadata?.linkedSegmentId;
    if (typeof segmentId === 'string' && segmentIndex.has(segmentId)) {
      materialSegmentMap.set(material.id, segmentId);
    }
  });
  const segmentRanges = new Map<string, SegmentTimeRange>();
  const latestVoiceById = new Map<string, MaterialItem>();
  segmentIndex.forEach((_entry, segmentId) => {
    const range = computeSegmentTimeRange(tracks, materialsById, segmentId);
    if (range) segmentRanges.set(segmentId, range);
    const voice = findLatestVoiceMaterial(materials, segmentId);
    if (voice) latestVoiceById.set(segmentId, voice);
  });
  return { segmentIndex, itemSegmentMap, materialSegmentMap, segmentRanges, latestVoiceById };
}

function deriveStatuses(
  segments: readonly ScriptSegment[],
  materials: readonly MaterialItem[],
  tracks: readonly LinkableTrack[],
  converting: ReadonlySet<string>,
): Map<string, SegmentStatus> {
  const materialsById = buildMaterialsById(materials);
  const statuses = new Map<string, SegmentStatus>();
  segments.forEach((segment) => {
    statuses.set(segment.id, deriveSegmentStatus({
      segment, materials, tracks, materialsById, isConverting: converting.has(segment.id),
    }));
  });
  return statuses;
}

export function useSegmentLinks(input: UseSegmentLinksInput): UseSegmentLinksReturn {
  const { segments, materials, isPlaceholderScript, currentTime } = input;
  const tracks = useTimelineStore((state) => state.tracks) as readonly LinkableTrack[];
  const converting = useEditorFocusStore((state) => state.convertingSegmentIds);
  const selectedSegmentId = useEditorFocusStore((state) => state.selectedSegmentId);

  const staticLinks = useMemo(
    () => deriveStaticLinks(segments, materials, tracks),
    [segments, materials, tracks],
  );
  const statusById = useMemo(
    () => (isPlaceholderScript
      ? new Map<string, SegmentStatus>()
      : deriveStatuses(segments, materials, tracks, converting)),
    [isPlaceholderScript, segments, materials, tracks, converting],
  );
  const highlightedItemIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedSegmentId) return ids;
    staticLinks.itemSegmentMap.forEach((segmentId, itemId) => {
      if (segmentId === selectedSegmentId) ids.add(itemId);
    });
    return ids;
  }, [staticLinks, selectedSegmentId]);

  const links = useMemo<SegmentLinksValue>(() => ({
    ...staticLinks,
    statusById,
    highlightedItemIds,
    isPlaceholderScript,
  }), [staticLinks, statusById, highlightedItemIds, isPlaceholderScript]);

  const playingSegmentId = findPlayingSegmentId(staticLinks.segmentRanges, currentTime);
  return { links, playingSegmentId };
}
