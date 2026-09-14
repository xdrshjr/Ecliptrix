import { describe, expect, it } from 'vitest';

import { findTrackForMaterial, isTrackCompatibleWithMaterial } from '../trackForMaterial';

const track = (id: string, type: 'video' | 'audio' | 'subtitle', isLocked = false) => ({
  id,
  type,
  isLocked,
});

describe('findTrackForMaterial', () => {
  it('picks the first unlocked compatible track', () => {
    const tracks = [track('audio-track-1', 'audio', true), track('audio-track-2', 'audio')];
    expect(findTrackForMaterial(tracks, 'audio')).toEqual({ trackId: 'audio-track-2' });
  });

  it('reports all-locked when every compatible track is locked', () => {
    const tracks = [track('video-track-1', 'video', true), track('audio-track-1', 'audio')];
    expect(findTrackForMaterial(tracks, 'video')).toEqual({ trackId: null, reason: 'all-locked' });
  });

  it('reports no-compatible-track when nothing can hold the material', () => {
    const tracks = [track('video-track-1', 'video')];
    expect(findTrackForMaterial(tracks, 'audio')).toEqual({
      trackId: null,
      reason: 'no-compatible-track',
    });
  });
});

describe('isTrackCompatibleWithMaterial', () => {
  it('keeps videos off image tracks while images may use any video track', () => {
    const imageTrack = track('image-track-1', 'video');
    const videoTrack = track('video-track-1', 'video');
    expect([
      isTrackCompatibleWithMaterial(imageTrack, 'video'),
      isTrackCompatibleWithMaterial(videoTrack, 'video'),
      isTrackCompatibleWithMaterial(imageTrack, 'image'),
      isTrackCompatibleWithMaterial(videoTrack, 'image'),
    ]).toEqual([false, true, true, true]);
  });
});
