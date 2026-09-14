/**
 * PV3-04 / N-18 (S13) — a refused image-overlay commit puts the editor's
 * timeline state back on the stored position, so preview, export and autosave
 * never keep a position the timeline did not record.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../timeline/store/useTimelineStore';
import {
  imageEditBlocker,
  readImagePosition,
} from '../../timeline/store/actions/updateItemFields';
import type { ImagePosition, TimelineData } from '../../timeline/domain';
import { resolveImagePositionCommit } from '../imagePositionCommit';

const get = () => useTimelineStore.getState();

const STORED: ImagePosition = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, zIndex: 10 };

function timeline(isLocked: boolean): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 6,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'image-track-1',
        name: 'Images',
        type: 'video',
        height: 80,
        isLocked,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'image-1',
            name: 'Overlay',
            type: 'video',
            startTime: 0,
            duration: 6,
            trackId: 'image-track-1',
            color: '#8b5cf6',
            materialId: 'image-material-1',
            originalMaterialType: 'image',
            imagePosition: STORED,
          },
        ],
      },
    ],
  };
}

function commitFor(itemId: string) {
  return resolveImagePositionCommit(imageEditBlocker(get, itemId), readImagePosition(get, itemId));
}

beforeEach(() => {
  get().setExternalEditLock(null);
  get().initTimeline(timeline(false));
  get().clearHistory();
});

describe('resolveImagePositionCommit', () => {
  it('a refused confirm on a locked track reverts the owner position to the store value', () => {
    get().initTimeline(timeline(true));
    expect(commitFor('image-1')).toEqual({ kind: 'revert', position: STORED, reason: 'track-locked' });
  });

  it('an agent-lock refusal mid-gesture reverts the owner position', () => {
    get().setExternalEditLock('agent');
    expect(commitFor('image-1')).toEqual({ kind: 'revert', position: STORED, reason: 'agent-lock' });
  });

  it('a missing item is ignored without a warning', () => {
    expect(commitFor('gone')).toEqual({ kind: 'ignore' });
  });

  it('an editable item is applied', () => {
    expect(commitFor('image-1')).toEqual({ kind: 'apply' });
  });
});
