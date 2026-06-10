/**
 * Export-path regression guard for desktop local editing.
 *
 * `seq.url` is now the canonical backend media reference selected by the
 * extractor. Desktop local exports may carry same-origin `/api/storage/files`
 * references; preview-only blob/proxy URLs must still stay out of payloads.
 */
import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import type { VideoSequenceItem, AudioSequenceItem } from '../../domain/ports';
import type { TrackData, MaterialData } from '../../domain/types';

describe('CompositionAdapter.buildCompositionRequest export-path safety', () => {
  it('emits the chosen canonical local media reference', () => {
    const adapter = new CompositionAdapter();
    const videoSequences: VideoSequenceItem[] = [
      {
        id: 'seq-1',
        name: 'Video by Test',
        url: '/api/storage/files/cached_materials/pexels/1.mp4',
        cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
        startTime: 0,
        duration: 5,
        clipStart: 0,
        clipEnd: 5,
        originalDuration: 5,
        trackId: 't-1',
        volume: 1,
      },
    ];
    const audioSequences: AudioSequenceItem[] = [];
    const request = adapter.buildCompositionRequest(videoSequences, audioSequences, {
      width: 1920,
      height: 1080,
      format: 'mp4',
      taskId: 'task-1',
      totalDuration: 5,
    });
    expect(request.video_sequences).toHaveLength(1);
    expect(request.video_sequences[0].url).toBe('/api/storage/files/cached_materials/pexels/1.mp4');
    expect(JSON.stringify(request.video_sequences[0])).not.toContain('localProxyUrl');
    expect(JSON.stringify(request.video_sequences[0])).not.toContain('previewProxyLocalUrl');
  });

  it('preserves seq.url exactly even when only cacheUrl is set on the sequence', () => {
    // Defensive: even if a future refactor populated `seq.url` from cacheUrl,
    // the export builder should still read whatever is in `seq.url` — the
    // upstream extractor (CompositionAdapter.extractVideoSequences) is the
    // single source of truth for what `seq.url` contains.
    const adapter = new CompositionAdapter();
    const sequences: VideoSequenceItem[] = [
      {
        id: 'seq-2',
        name: 'Video by Two',
        url: 'https://example.com/server.mp4',
        startTime: 0,
        duration: 3,
        trackId: 't-2',
      },
    ];
    const request = adapter.buildCompositionRequest(sequences, [], {});
    expect(request.video_sequences[0].url).toBe('https://example.com/server.mp4');
  });

  it('extracts nested metadata.localResolvedUrl for direct local export', () => {
    const adapter = new CompositionAdapter();
    const tracks: TrackData[] = [
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
            name: 'Local',
            type: 'video',
            materialId: 'mat-1',
            trackId: 'track-1',
            startTime: 0,
            duration: 5,
            color: '#2563eb',
          },
        ],
      },
    ];
    const materials = [
      {
        id: 'mat-1',
        name: 'Local',
        type: 'video',
        url: 'blob:http://localhost/stale',
        serverUrl: '/api/media/proxy?u=https%3A%2F%2Fcdn.example.com%2Fv.mp4',
        metadata: {
          storageKind: 'local',
          isLocalFile: true,
          localResolvedUrl: '/api/storage/files/video/local.mp4',
        },
      },
    ] as unknown as MaterialData[];

    const sequences = adapter.extractVideoSequences(tracks, materials);

    expect(sequences[0].url).toBe('/api/storage/files/video/local.mp4');
  });

  it('extractVideoSequences keeps export URLs local and excludes preview-only refs', () => {
    const adapter = new CompositionAdapter();
    const tracks: TrackData[] = [
      {
        id: 'track-0',
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
            name: 'Local',
            type: 'video',
            materialId: 'mat-1',
            trackId: 'track-0',
            startTime: 0,
            duration: 5,
            color: '#2563eb',
          },
        ],
      },
    ];
    const materials = [
      {
        id: 'mat-1',
        name: 'Local',
        type: 'video',
        url: 'blob:http://localhost/stale',
        cacheUrl: '/api/storage/files/cached_materials/pexels/9.mp4',
        // preview-proxy fields that export must never emit:
        previewProxyLocalUrl: '/api/storage/files/preview-proxies/9.mp4',
        previewProxyStatus: 'cached',
      },
    ] as unknown as MaterialData[];

    const sequences = adapter.extractVideoSequences(tracks, materials);
    // Same selection contract as selectPlaybackUrl(export): the same-origin
    // local cache reference is chosen, preview-only refs excluded.
    expect(sequences[0].url).toBe('/api/storage/files/cached_materials/pexels/9.mp4');
    const serialized = JSON.stringify(
      adapter.buildCompositionRequest(sequences, [], { taskId: 't', totalDuration: 5 }),
    );
    expect(serialized).not.toContain('blob:');
    expect(serialized).not.toContain('preview-proxies');
    expect(serialized).not.toContain('/api/media/proxy');
  });

  it('forwards track_z / opacity / transitions / audio_detached into the request', () => {
    const adapter = new CompositionAdapter();
    const videoSequences: VideoSequenceItem[] = [
      {
        id: 'seq-bottom',
        name: 'Bottom',
        url: '/api/storage/files/video/bottom.mp4',
        startTime: 0,
        duration: 6,
        clipStart: 0,
        clipEnd: 6,
        originalDuration: 6,
        trackId: 't-bottom',
        volume: 1,
        trackZ: 0,
        opacity: 1,
      },
      {
        id: 'seq-top',
        name: 'Top',
        url: '/api/storage/files/video/top.mp4',
        startTime: 0,
        duration: 6,
        clipStart: 0,
        clipEnd: 6,
        originalDuration: 6,
        trackId: 't-top',
        volume: 1,
        trackZ: 1,
        opacity: 0.5,
        audioDetached: true,
        transitionIn: { type: 'fade', duration: 0.5 },
        transitionOut: { type: 'dissolve', duration: 1 },
      },
    ];
    const request = adapter.buildCompositionRequest(videoSequences, [], {
      taskId: 't',
      totalDuration: 6,
    });
    const byId = Object.fromEntries(request.video_sequences.map((v) => [v.id, v]));
    expect(byId['seq-bottom'].track_z).toBe(0);
    expect(byId['seq-top'].track_z).toBe(1);
    expect(byId['seq-top'].opacity).toBe(0.5);
    expect(byId['seq-top'].audio_detached).toBe(true);
    expect(byId['seq-top'].transition_in).toEqual({ type: 'fade', duration: 0.5 });
    expect(byId['seq-top'].transition_out).toEqual({ type: 'dissolve', duration: 1 });
  });
});
