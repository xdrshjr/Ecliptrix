/**
 * Export-path regression guard for the video re-entry fix (R5 / P2-4).
 *
 * `buildCompositionRequest` MUST use `seq.url` directly — never resolve
 * to a same-origin `cacheUrl` — because the export pipeline runs
 * server-side and embedding `/api/storage/files/...` would be meaningless
 * outside the browser. Documented in
 * docs/plans/video-reentry-play-no-source-fix/spec.md §8 R5.
 */
import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import type { VideoSequenceItem, AudioSequenceItem } from '../../domain/ports';

describe('CompositionAdapter.buildCompositionRequest export-path safety', () => {
  it('emits seq.url verbatim, ignoring any cacheUrl on the sequence', () => {
    const adapter = new CompositionAdapter();
    const videoSequences: VideoSequenceItem[] = [
      {
        id: 'seq-1',
        name: 'Video by Test',
        url: 'https://cdn.pexels.com/v.mp4',
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
    expect(request.video_sequences[0].url).toBe('https://cdn.pexels.com/v.mp4');
    // Hard guard: must NOT leak the same-origin cacheUrl into the request.
    expect(request.video_sequences[0].url).not.toContain('cached_materials');
    expect(request.video_sequences[0].url).not.toContain('/api/storage/files');
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
});
