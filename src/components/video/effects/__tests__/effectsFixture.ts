import type { EffectAsset, EffectTargetSnapshot } from '@/types/effects';
import type { TimelineData } from '../../timeline/domain/types';
import { fingerprintEffectTarget } from '@/lib/effects/provenance';

export function effectsFixture() {
  const timeline: TimelineData = { currentTime: 0, totalDuration: 10,
    zoomLevel: 1, playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 1, scrollLeft: 0, tracks: [{ id: 'v', name: 'Video', type: 'video',
      order: 0, height: 56, isLocked: false, isVisible: true, isMuted: false,
      volume: 100, items: [{ id: 'clip', trackId: 'v', name: 'Original',
        type: 'video', color: '#111111', startTime: 4, duration: 3.37,
        materialId: 'original', clipStart: 2, clipEnd: 5.37, originalDuration: 10,
        url: '/api/storage/files/original.mp4', cacheUrl: '/api/storage/files/old.mp4',
        opacity: 0.8, volume: 80, audioDetached: true,
        transitionIn: { type: 'fade', duration: 0.2 },
        metadata: { linkedSegmentId: 'segment', localResolvedUrl: '/old-proxy' } }] }] };
  const target: EffectTargetSnapshot = { projectId: 'p', trackId: 'v',
    clipId: 'clip', durationSeconds: 3.37, durationFrames: 102,
    trimStartFrame: 60, sourceSha256: 'original-hash', targetFingerprint:
      fingerprintEffectTarget(timeline.tracks[0], timeline.tracks[0].items[0]) };
  const asset: EffectAsset = { id: 'asset', projectId: 'p', kind: 'output-video',
    sha256: 'new-hash', bytes: 10000, width: 1920, height: 1080,
    url: '/api/storage/files/effects/projects/p/outputs/j/video.mp4',
    storageKey: 'effects/projects/p/outputs/j/video.mp4', durationSeconds: 3.4,
    createdAt: '2026-11-17', effects: { schemaVersion: 1, projectId: 'p',
      draftId: 'd', draftVersion: 1, jobId: 'j', assetId: 'asset',
      templateId: 'title-rise', templateVersion: 1, documentHash: 'hash' },
    provenance: { jobId: 'j', draftId: 'd', draftVersion: 1, documentHash: 'hash',
      inputHash: 'input', durationFrames: 102, fps: 30,
      canvas: { width: 1920, height: 1080 }, baseVideo: { assetId: 'input',
        sourceSha256: 'original-hash', trimStartFrame: 60, sourceFrameCount: 102,
        displayWidth: 1920, displayHeight: 1080 } } };
  return { timeline, asset, intent: { projectId: 'p', operationId: 'op',
    mode: 'replace' as const, target } };
}
