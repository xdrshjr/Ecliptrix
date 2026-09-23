/**
 * SegmentLinksContext — the ONE segment derivation of the editor (spec RV-01).
 *
 * `VideoEditingInterface` calls `useSegmentLinks` exactly once with the same
 * segments/materials it hands to ScriptPanel and MaterialsPanel, and provides
 * the result here. Script cards, timeline labels/highlights, the materials
 * "used in segment N" chips, the inspector and the assistant drawer all read
 * this object, so there is no second derivation path that could drift.
 *
 * The playing segment lives in its own context: it changes during playback,
 * and only the few consumers that show "now playing" should re-render for it.
 */

import { createContext, useContext } from 'react';
import type { MaterialItem } from '@/types';
import type {
  SegmentIndexEntry,
  SegmentStatus,
  SegmentTimeRange,
} from './segmentLinks';

export interface SegmentLinksValue {
  /** segmentId → ordinal / badge / label ("01 丝滑亮相"). */
  segmentIndex: ReadonlyMap<string, SegmentIndexEntry>;
  /** timeline itemId → owning segmentId (only for known segments). */
  itemSegmentMap: ReadonlyMap<string, string>;
  /** materialId → segmentId, for the "used in segment N" chip. */
  materialSegmentMap: ReadonlyMap<string, string>;
  /** segmentId → time range on the timeline (narration first). */
  segmentRanges: ReadonlyMap<string, SegmentTimeRange>;
  /** segmentId → derived chip status. Empty for placeholder scripts. */
  statusById: ReadonlyMap<string, SegmentStatus>;
  /** segmentId → newest voice-over material in the library. */
  latestVoiceById: ReadonlyMap<string, MaterialItem>;
  /** Items linked to the currently selected segment (outline highlight). */
  highlightedItemIds: ReadonlySet<string>;
  /** True while the panel shows the placeholder script (RV-21). */
  isPlaceholderScript: boolean;
}

const EMPTY_VALUE: SegmentLinksValue = {
  segmentIndex: new Map(),
  itemSegmentMap: new Map(),
  materialSegmentMap: new Map(),
  segmentRanges: new Map(),
  statusById: new Map(),
  latestVoiceById: new Map(),
  highlightedItemIds: new Set(),
  isPlaceholderScript: true,
};

export const SegmentLinksContext = createContext<SegmentLinksValue>(EMPTY_VALUE);
export const PlayingSegmentContext = createContext<string | null>(null);

export function useSegmentLinksValue(): SegmentLinksValue {
  return useContext(SegmentLinksContext);
}

export function usePlayingSegmentId(): string | null {
  return useContext(PlayingSegmentContext);
}
