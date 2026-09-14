/**
 * Image-overlay selection for the video player preview.
 *
 * Extracted from VideoPlayerPanel (D10 split, S4). Pure function — no React, no
 * DOM — so the per-time selection is independently unit-testable. The compositor
 * rasterises image overlays on-canvas (ImageOverlayLayer); this list drives the
 * draggable React `<ImageOverlay>` handles layered over the preview.
 */

import type { TimelineState, MaterialItem, ImagePosition } from '@/types';
import { isStillImageItem } from '../../timeline/infrastructure/renderableTimeline';

export interface ActiveImageOverlay {
  id: string;
  url: string;
  position: ImagePosition;
  materialId?: string;
}

export type ImageOverlayPlaybackMode = 'composition' | 'preview';

// Centered 80% default (D1): kept in sync with the other default sites
// (ItemPlacementService / ImageOverlayLayer / useVideoExport) so the fallback
// for an item without imagePosition matches a freshly added image.
const DEFAULT_OVERLAY_POSITION: ImagePosition = {
  x: 0.1,
  y: 0.1,
  width: 0.8,
  height: 0.8,
  zIndex: 10,
};

export function getImageOverlayPlaybackTime(
  playbackMode: ImageOverlayPlaybackMode,
  currentTimelineTime: number | undefined,
  compositionCurrentTime: number,
  currentTime: number,
): number {
  return playbackMode === 'composition'
    ? (currentTimelineTime ?? compositionCurrentTime)
    : currentTime;
}

/**
 * Select the image-overlay items active at `currentPlaybackTime`: still-image
 * items (`isStillImageItem`, the same rule export uses) on a VISIBLE track whose
 * `[start, start+duration)` window covers the time and whose material has a
 * usable URL.
 * Items whose material is missing / has no URL are reported via `onMissing` and
 * dropped (so the caller can log without the selection being impure).
 */
export function selectActiveImageOverlays(
  timelineState: TimelineState | undefined,
  materials: readonly MaterialItem[] | undefined,
  currentPlaybackTime: number,
  onMissing?: (info: { itemId: string; materialId?: string; materialFound: boolean; materialHasUrl: boolean }) => void,
): ActiveImageOverlay[] {
  if (!timelineState || !materials) return [];

  const overlays: ActiveImageOverlay[] = [];
  for (const track of timelineState.tracks) {
    if (!track.isVisible) continue;
    for (const item of track.items) {
      if (
        currentPlaybackTime < item.startTime ||
        currentPlaybackTime >= item.startTime + item.duration
      ) {
        continue;
      }
      const material = materials.find((m) => m.id === item.materialId);
      if (!isStillImageItem(item, material)) continue;
      if (material && material.url) {
        overlays.push({
          id: item.id,
          url: material.url,
          position: item.imagePosition || DEFAULT_OVERLAY_POSITION,
          materialId: item.materialId,
        });
      } else if (onMissing) {
        onMissing({
          itemId: item.id,
          materialId: item.materialId,
          materialFound: !!material,
          materialHasUrl: material ? !!material.url : false,
        });
      }
    }
  }
  return overlays;
}
