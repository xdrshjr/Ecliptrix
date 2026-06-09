/**
 * CompositionAdapter — round-2 timeline local-preview fix
 * (docs/plans/timeline-material-preview-fix/spec.md).
 *
 * A direct-local upload (saved under /api/storage/files/video/...) must yield a
 * video sequence whose `url` is the canonical same-origin local reference and
 * whose `cacheUrl` hint is preserved, so the player's live-material resolver can
 * pick the local storage URL for preview without any ingest/transcode/proxy.
 */
import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import type { TrackData, MaterialData } from '../../domain/types';

const LOCAL_URL = '/api/storage/files/video/local.mp4';

function makeVideoTrack(): TrackData[] {
  return [
    {
      id: 'track-1',
      name: 'Video',
      type: 'video',
      isVisible: true,
      isLocked: false,
      isMuted: false,
      volume: 100,
      height: 80,
      order: 0,
      items: [
        {
          id: 'item-1',
          name: 'local.mp4',
          type: 'video',
          materialId: 'mat-1',
          trackId: 'track-1',
          startTime: 0,
          duration: 5,
          clipStart: 0,
          clipEnd: 5,
          originalDuration: 5,
          color: '#2563eb',
        },
      ],
    },
  ];
}

describe('CompositionAdapter — direct local material preview', () => {
  it('produces a sequence whose url is the canonical local storage reference and preserves cacheUrl', () => {
    const adapter = new CompositionAdapter();
    const materials = [
      {
        id: 'mat-1',
        name: 'local.mp4',
        type: 'video',
        url: LOCAL_URL,
        serverUrl: LOCAL_URL,
        cacheUrl: LOCAL_URL,
        storageKey: 'video/local.mp4',
        metadata: {
          storageKind: 'local',
          isLocalFile: true,
          localResolvedUrl: LOCAL_URL,
        },
      },
    ] as unknown as MaterialData[];

    const sequences = adapter.extractVideoSequences(makeVideoTrack(), materials);

    expect(sequences).toHaveLength(1);
    expect(sequences[0].url).toBe(LOCAL_URL);
    expect(sequences[0].cacheUrl).toBe(LOCAL_URL);
    expect(sequences[0].materialId).toBe('mat-1');
  });

  it('never emits a preview-only blob/proxy URL as the sequence url for a local material', () => {
    const adapter = new CompositionAdapter();
    const materials = [
      {
        id: 'mat-1',
        name: 'local.mp4',
        type: 'video',
        // A stale preview-only blob must not win over the resolvable local path.
        url: 'blob:http://localhost/stale-preview',
        serverUrl: LOCAL_URL,
        cacheUrl: LOCAL_URL,
        metadata: {
          storageKind: 'local',
          isLocalFile: true,
          localResolvedUrl: LOCAL_URL,
        },
      },
    ] as unknown as MaterialData[];

    const sequences = adapter.extractVideoSequences(makeVideoTrack(), materials);

    expect(sequences[0].url).toBe(LOCAL_URL);
    expect(sequences[0].url.startsWith('blob:')).toBe(false);
  });
});
