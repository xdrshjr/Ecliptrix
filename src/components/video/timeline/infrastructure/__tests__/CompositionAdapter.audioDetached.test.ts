/**
 * CompositionAdapter — audioDetached passthrough (spec 01 §3 / §4).
 *
 * The detach flag must flow verbatim from the timeline item onto the video
 * sequence and into the snake_case composition request, WITHOUT changing URL
 * selection. Preview (02) and export (05) consume the flag to suppress the
 * video's audio so the derived audio sequence is the sole contributor.
 */

import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import type { CompositionMaterialData } from '../CompositionAdapter';
import type { TrackData } from '../../domain/types';

function videoTrack(audioDetached?: boolean): TrackData {
  return {
    id: 't1', name: 'V1', type: 'video', isVisible: true, isLocked: false,
    isMuted: false, volume: 100, height: 60, order: 0,
    items: [
      {
        id: 'item-1', name: 'clip', type: 'video', startTime: 0, duration: 5,
        trackId: 't1', materialId: 'm1', color: '#4A90D9',
        clipStart: 0, clipEnd: 5, originalDuration: 5, volume: 1,
        audioDetached,
      },
    ],
  };
}

const MAT: CompositionMaterialData = {
  id: 'm1', name: 'sample.mp4', type: 'video', duration: 5,
  url: '/api/storage/files/uploads/video/sample.mp4',
};

describe('CompositionAdapter audioDetached passthrough', () => {
  it('forwards audioDetached=true onto the video sequence', () => {
    const adapter = new CompositionAdapter();
    const [seq] = adapter.extractVideoSequences([videoTrack(true)], [MAT as never]);
    expect(seq.audioDetached).toBe(true);
  });

  it('leaves audioDetached undefined when the item never detached', () => {
    const adapter = new CompositionAdapter();
    const [seq] = adapter.extractVideoSequences([videoTrack(undefined)], [MAT as never]);
    expect(seq.audioDetached).toBeUndefined();
  });

  it('serialises audio_detached into the composition request', () => {
    const adapter = new CompositionAdapter();
    const seqs = adapter.extractVideoSequences([videoTrack(true)], [MAT as never]);
    const req = adapter.buildCompositionRequest(seqs, [], {});
    expect(req.video_sequences[0].audio_detached).toBe(true);
  });

  it('does not change URL selection when detaching audio', () => {
    const adapter = new CompositionAdapter();
    const [withDetach] = adapter.extractVideoSequences([videoTrack(true)], [MAT as never]);
    const [without] = adapter.extractVideoSequences([videoTrack(undefined)], [MAT as never]);
    expect(withDetach.url).toBe(without.url);
    expect(withDetach.url).toBe('/api/storage/files/uploads/video/sample.mp4');
  });
});
