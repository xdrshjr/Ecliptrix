/**
 * assembleLayers — canvas fit (spec segment-centric-editor-workbench-r2
 * §3.9.2): a non-default fit reaches every video layer; `contain` layers are
 * built exactly as before (no `fit` key at all).
 */

import { describe, it, expect } from 'vitest';
import { assembleLayers, type ActiveVideoEntry } from '../internal/assembleLayers';
import type { VideoSequenceItem } from '../../types';

const CLIP: VideoSequenceItem = {
  id: 'clip-1', name: 'clip', url: '/api/storage/files/a.mp4',
  startTime: 0, duration: 6, trackId: 'video-1',
};

const ENTRY: ActiveVideoEntry = {
  trackId: 'video-1', z: 0,
  source: { readyState: 4, videoWidth: 1080, videoHeight: 1920 },
  clip: CLIP,
};

function videoLayers(videoFit?: 'contain' | 'cover' | 'blur') {
  return assembleLayers({
    videoEntries: [ENTRY, { ...ENTRY, trackId: 'video-2', z: 1 }],
    subtitleItems: [],
    imageItems: [],
    t: 1,
    output: { width: 1920, height: 1080 },
    videoFit,
  });
}

describe('assembleLayers — video fit', () => {
  it('adds no fit key for contain or an absent fit', () => {
    for (const layer of [...videoLayers(), ...videoLayers('contain')]) {
      expect(Object.prototype.hasOwnProperty.call(layer, 'fit')).toBe(false);
    }
  });

  it('gives every video layer the project fit', () => {
    const layers = videoLayers('blur');

    expect(layers).toHaveLength(2);
    expect(layers.map((layer) => (layer as { fit?: string }).fit))
      .toEqual(['blur', 'blur']);
  });
});
