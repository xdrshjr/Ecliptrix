/**
 * assembleLayers tests (spec 02 §2.2 / §2.4 / §6).
 *
 * Pure — no canvas. Verifies the layer list the multi-track engine hands to
 * CanvasCompositor.renderFrame:
 *   - z-order: video by track z, image + subtitle lifted above all video;
 *   - effective video opacity = item.opacity × transition alpha;
 *   - transition fade-in/out folded at the composition time;
 *   - idle / unready tracks contribute no layer.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleLayers,
  buildVideoLayers,
  buildSubtitleLayers,
  type ActiveVideoEntry,
} from '../internal/assembleLayers';
import type { ImageOverlayInput } from '../ImageOverlayLayer';
import type { VideoSequenceItem, SubtitleSequenceItem } from '../../types';

function clip(over: Partial<VideoSequenceItem> & { id: string }): VideoSequenceItem {
  return {
    name: over.id,
    url: '',
    startTime: 0,
    duration: 10,
    trackId: 't',
    clipStart: 0,
    clipEnd: 10,
    ...over,
  } as VideoSequenceItem;
}

function readySource() {
  return { readyState: 4 };
}

describe('buildVideoLayers — opacity × transition alpha', () => {
  it('full opacity body → effective opacity 1', () => {
    const entries: ActiveVideoEntry[] = [
      { trackId: 't1', z: 0, source: readySource(), clip: clip({ id: 'a' }) },
    ];
    const layers = buildVideoLayers(entries, 5);
    expect(layers[0].opacity).toBeCloseTo(1, 6);
  });

  it('item opacity multiplies the transition alpha (fade-in midpoint)', () => {
    const c = clip({
      id: 'a',
      startTime: 0,
      duration: 10,
      opacity: 0.5,
      transitionIn: { type: 'fade', duration: 4 },
    });
    const entries: ActiveVideoEntry[] = [{ trackId: 't1', z: 0, source: readySource(), clip: c }];
    // At t=2, fade-in alpha = 2/4 = 0.5; × item opacity 0.5 → 0.25.
    const layers = buildVideoLayers(entries, 2);
    expect(layers[0].opacity).toBeCloseTo(0.25, 6);
  });

  it('fade-out ramp is applied at the trailing edge', () => {
    const c = clip({
      id: 'a',
      startTime: 0,
      duration: 10,
      transitionOut: { type: 'fade', duration: 4 },
    });
    const entries: ActiveVideoEntry[] = [{ trackId: 't1', z: 0, source: readySource(), clip: c }];
    // At t=8, untilEnd=2, fadeOut=4 → 2/4 = 0.5.
    const layers = buildVideoLayers(entries, 8);
    expect(layers[0].opacity).toBeCloseTo(0.5, 6);
  });

  it('drops an entry with no source or no clip', () => {
    const entries: ActiveVideoEntry[] = [
      { trackId: 't1', z: 0, source: null, clip: clip({ id: 'a' }) },
      { trackId: 't2', z: 1, source: readySource(), clip: null },
    ];
    expect(buildVideoLayers(entries, 1)).toHaveLength(0);
  });
});

describe('assembleLayers — z-order across kinds', () => {
  it('orders bottom video < top video < image < subtitle by z ascending', () => {
    const videoEntries: ActiveVideoEntry[] = [
      { trackId: 'bottom', z: 0, source: readySource(), clip: clip({ id: 'a' }) },
      { trackId: 'top', z: 1, source: readySource(), clip: clip({ id: 'b' }) },
    ];
    const imageItems: ImageOverlayInput[] = [
      { id: 'img', src: '/x.png', startTime: 0, duration: 10, position: { x: 0, y: 0, width: 0.3, height: 0.3 } },
    ];
    const subtitleItems: SubtitleSequenceItem[] = [
      { id: 'sub', text: 'caption', startTime: 0, duration: 10, trackId: 'st' },
    ];
    const layers = assembleLayers({
      videoEntries,
      subtitleItems,
      imageItems,
      t: 5,
      output: { width: 1920, height: 1080 },
    });
    const kinds = layers.map((l) => l.kind);
    // video, video, image, subtitle in ascending z.
    expect(kinds[0]).toBe('video');
    expect(kinds[1]).toBe('video');
    expect(kinds[kinds.length - 1]).toBe('subtitle');
    expect(kinds.includes('image')).toBe(true);
    // strictly ascending z
    for (let i = 1; i < layers.length; i++) {
      expect(layers[i].z).toBeGreaterThanOrEqual(layers[i - 1].z);
    }
    // image sits above both video layers
    const imageZ = layers.find((l) => l.kind === 'image')!.z;
    const videoZMax = Math.max(...layers.filter((l) => l.kind === 'video').map((l) => l.z));
    expect(imageZ).toBeGreaterThan(videoZMax);
  });

  it('omits subtitle/image layers that are not active at t', () => {
    const videoEntries: ActiveVideoEntry[] = [
      { trackId: 'v', z: 0, source: readySource(), clip: clip({ id: 'a' }) },
    ];
    const layers = assembleLayers({
      videoEntries,
      subtitleItems: [{ id: 's', text: 'x', startTime: 100, duration: 5, trackId: 'st' }],
      imageItems: [{ id: 'i', src: '/x.png', startTime: 100, duration: 5 }],
      t: 5,
      output: { width: 1920, height: 1080 },
    });
    expect(layers.every((l) => l.kind === 'video')).toBe(true);
    expect(layers).toHaveLength(1);
  });

  it('a higher zIndex image draws above a later lower zIndex image', () => {
    const layers = assembleLayers({
      videoEntries: [],
      subtitleItems: [],
      imageItems: [
        { id: 'front', src: '/a.png', startTime: 0, duration: 10, position: { x: 0, y: 0, width: 0.5, height: 0.5, zIndex: 20 } },
        { id: 'back', src: '/b.png', startTime: 0, duration: 10, position: { x: 0, y: 0, width: 0.5, height: 0.5, zIndex: 5 } },
      ],
      t: 5,
      output: { width: 1920, height: 1080 },
    });
    expect(layers.map((l) => l.id)).toEqual(['back', 'front']);
  });

  it('images stay below subtitles for any zIndex', () => {
    const layers = assembleLayers({
      videoEntries: [],
      subtitleItems: [{ id: 'sub', text: 'caption', startTime: 0, duration: 10, trackId: 'st' }],
      imageItems: [
        { id: 'huge', src: '/a.png', startTime: 0, duration: 10, position: { x: 0, y: 0, width: 0.5, height: 0.5, zIndex: 10_000_000 } },
        { id: 'negative', src: '/b.png', startTime: 0, duration: 10, position: { x: 0, y: 0, width: 0.5, height: 0.5, zIndex: -40 } },
      ],
      t: 5,
      output: { width: 1920, height: 1080 },
    });
    const subtitleZ = layers.find((l) => l.kind === 'subtitle')!.z;
    const imageZ = layers.filter((l) => l.kind === 'image').map((l) => l.z);
    expect(Math.max(...imageZ)).toBeLessThan(subtitleZ);
  });
});

describe('buildSubtitleLayers — output-pixel layout (EXO-09)', () => {
  it('wraps against the output width and drops subtitles with no visible line', () => {
    const items: SubtitleSequenceItem[] = [
      { id: 's', text: 'one two three four five', startTime: 0, duration: 10, trackId: 'st' },
      { id: 'empty', text: '', startTime: 0, duration: 10, trackId: 'st' },
      { id: 'blank', text: '  \n ', startTime: 0, duration: 10, trackId: 'st' },
    ];
    // 340 px wide at the default 24 px → floor(240 / 24) = 10 chars per line.
    const layers = buildSubtitleLayers(items, 5, { width: 340, height: 1080 }, 1_000_000);
    expect(layers.map((layer) => layer.id)).toEqual(['s']);
    expect(layers[0].lines.map((line) => line.text)).toEqual(['one two', 'three four', 'five']);
    expect(layers[0].outputHeight).toBe(1080);
  });
});
