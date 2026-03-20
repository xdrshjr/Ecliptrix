/**
 * Test Utility — createTestTimeline
 *
 * Factory for creating a pre-populated TimelineAggregate for testing.
 * Provides a standard timeline with:
 *   - 1 video track (2 items)
 *   - 1 audio track (1 item)
 *   - 1 subtitle track (1 item)
 *
 * Usage:
 *   const timeline = createTestTimeline();
 *   // or with overrides:
 *   const timeline = createTestTimeline({ totalDuration: 30 });
 */

import { TimelineAggregate } from '../../domain';
import type { TimelineData, TrackData, TimelineItemData } from '../../domain/types';

// ---------------------------------------------------------------------------
// Default test data
// ---------------------------------------------------------------------------

const defaultVideoItem1: TimelineItemData = {
  id: 'test-video-item-1',
  name: 'Test Video 1',
  type: 'video',
  startTime: 0,
  duration: 5,
  trackId: 'test-video-track-1',
  color: '#4A90D9',
  materialId: 'test-material-video-1',
  thumbnailUrl: 'https://example.com/thumb1.jpg',
  volume: 1,
  opacity: 1,
};

const defaultVideoItem2: TimelineItemData = {
  id: 'test-video-item-2',
  name: 'Test Video 2',
  type: 'video',
  startTime: 5,
  duration: 5,
  trackId: 'test-video-track-1',
  color: '#4A90D9',
  materialId: 'test-material-video-2',
  thumbnailUrl: 'https://example.com/thumb2.jpg',
  volume: 1,
  opacity: 1,
};

const defaultAudioItem: TimelineItemData = {
  id: 'test-audio-item-1',
  name: 'Test Audio 1',
  type: 'audio',
  startTime: 0,
  duration: 10,
  trackId: 'test-audio-track-1',
  color: '#7B68EE',
  materialId: 'test-material-audio-1',
  volume: 1,
};

const defaultSubtitleItem: TimelineItemData = {
  id: 'test-subtitle-item-1',
  name: 'Test Subtitle 1',
  type: 'subtitle',
  startTime: 1,
  duration: 3,
  trackId: 'test-subtitle-track-1',
  color: '#FFB347',
  text: 'Hello, world!',
};

const defaultVideoTrack: TrackData = {
  id: 'test-video-track-1',
  name: 'Video Track 1',
  type: 'video',
  height: 80,
  isLocked: false,
  isMuted: false,
  isVisible: true,
  volume: 100,
  order: 0,
  items: [defaultVideoItem1, defaultVideoItem2],
};

const defaultAudioTrack: TrackData = {
  id: 'test-audio-track-1',
  name: 'Audio Track 1',
  type: 'audio',
  height: 60,
  isLocked: false,
  isMuted: false,
  isVisible: true,
  volume: 100,
  order: 1,
  items: [defaultAudioItem],
};

const defaultSubtitleTrack: TrackData = {
  id: 'test-subtitle-track-1',
  name: 'Subtitle Track 1',
  type: 'subtitle',
  height: 40,
  isLocked: false,
  isMuted: false,
  isVisible: true,
  volume: 100,
  order: 2,
  items: [defaultSubtitleItem],
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a test TimelineAggregate with sensible defaults.
 *
 * @param overrides - Partial TimelineData to override defaults.
 * @returns A fully initialized TimelineAggregate.
 */
export function createTestTimeline(
  overrides?: Partial<TimelineData>
): TimelineAggregate {
  const data: TimelineData = {
    currentTime: 0,
    totalDuration: 10,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [defaultVideoTrack, defaultAudioTrack, defaultSubtitleTrack],
    ...overrides,
  };

  return TimelineAggregate.fromPlainObject(data);
}

/**
 * Create an empty TimelineAggregate with no tracks.
 */
export function createEmptyTimeline(): TimelineAggregate {
  return TimelineAggregate.create();
}

/**
 * Get the default test data as plain objects (useful for snapshot comparisons).
 */
export const testDefaults = {
  videoTrack: defaultVideoTrack,
  audioTrack: defaultAudioTrack,
  subtitleTrack: defaultSubtitleTrack,
  videoItem1: defaultVideoItem1,
  videoItem2: defaultVideoItem2,
  audioItem: defaultAudioItem,
  subtitleItem: defaultSubtitleItem,
} as const;
