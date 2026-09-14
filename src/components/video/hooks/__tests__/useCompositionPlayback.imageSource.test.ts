/**
 * PV3-02 — the preview draws an image from the same local reference the export
 * sends, not from the remote URL it may still carry.
 */

import { describe, expect, it } from 'vitest';
import type { MaterialItem, TimelineState } from '@/types';
import { buildImageOverlayInputs } from '../useCompositionPlayback';

describe('buildImageOverlayInputs image source (PV3-02)', () => {
  it('image overlay input prefers the same-origin local reference export uses', () => {
    const timeline = {
      tracks: [
        {
          isVisible: true,
          items: [
            { id: 'img-1', originalMaterialType: 'image', materialId: 'pexels-img', startTime: 0, duration: 4 },
          ],
        },
      ],
    } as unknown as TimelineState;
    const material = {
      id: 'pexels-img',
      name: 'x.png',
      type: 'image',
      format: 'png',
      size: 1,
      url: 'https://images.example.com/x.png',
      serverUrl: 'https://images.example.com/x.png',
      cacheUrl: '/api/storage/files/cached_materials/pexels/x.png',
      createdAt: new Date(),
    } as MaterialItem;

    const [input] = buildImageOverlayInputs(timeline, [material]);

    expect(new URL(input.src).pathname).toBe('/api/storage/files/cached_materials/pexels/x.png');
  });
});
