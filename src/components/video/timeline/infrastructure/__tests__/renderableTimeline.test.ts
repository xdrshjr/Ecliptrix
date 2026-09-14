import { describe, expect, it } from 'vitest';
import type { MaterialItem, TimelineItem, Track } from '@/types';
import {
  collectRenderSpans,
  computeRenderEnd,
  computeVisualEnd,
  hasVisualSpan,
  indexMaterialsById,
  isTrackRendered,
} from '../renderableTimeline';

function material(id: string, type: MaterialItem['type']): Pick<MaterialItem, 'id' | 'type'> {
  return { id, type };
}

function item(id: string, startTime: number, duration: number, extra: Partial<TimelineItem> = {}): TimelineItem {
  return { id, name: id, type: 'video', startTime, duration, trackId: 't', color: '#000', ...extra };
}

function track(id: string, type: Track['type'], items: TimelineItem[], extra: Partial<Track> = {}): Track {
  return {
    id, name: id, type, height: 60, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, items, order: 0, ...extra,
  };
}

const materials = indexMaterialsById([
  material('v1', 'video'),
  material('a1', 'audio'),
  material('img', 'image'),
]);

describe('renderableTimeline', () => {
  it('hidden tracks and muted audio tracks are not rendered', () => {
    expect(isTrackRendered({ type: 'video', isVisible: false, isMuted: false })).toBe(false);
    expect(isTrackRendered({ type: 'audio', isVisible: true, isMuted: true })).toBe(false);
    expect(isTrackRendered({ type: 'video', isVisible: true, isMuted: true })).toBe(true);
    const spans = collectRenderSpans([
      track('hidden', 'video', [item('h', 0, 5, { materialId: 'v1' })], { isVisible: false }),
      track('muted', 'audio', [item('m', 0, 5, { materialId: 'a1', type: 'audio' })], { isMuted: true }),
    ], materials);
    expect(spans).toEqual([]);
  });

  it('locked tracks are rendered', () => {
    const spans = collectRenderSpans([
      track('locked', 'video', [item('l', 0, 5, { materialId: 'v1' })], { isLocked: true }),
    ], materials);
    expect(spans.map((span) => span.itemId)).toEqual(['l']);
  });

  it('render end is the latest rendered item end, not the sum', () => {
    const spans = collectRenderSpans([
      track('base', 'video', [item('b', 0, 6, { materialId: 'v1' })]),
      track('top', 'video', [item('t', 2, 2, { materialId: 'v1' })]),
    ], materials);
    expect(computeRenderEnd(spans)).toBe(6);
    expect(computeRenderEnd([])).toBe(0);
  });

  it('clips whose material is missing are not rendered', () => {
    const spans = collectRenderSpans([
      track('v', 'video', [item('gone', 0, 5, { materialId: 'deleted' })]),
      track('a', 'audio', [item('gone-audio', 0, 5, { materialId: 'deleted', type: 'audio' })]),
    ], materials);
    expect(spans).toEqual([]);
  });

  it('blank subtitles are not rendered', () => {
    const spans = collectRenderSpans([
      track('s', 'subtitle', [
        item('blank', 0, 2, { type: 'subtitle', text: '   ' }),
        item('named-only', 2, 2, { type: 'subtitle', name: 'Subtitle 1' }),
        item('real', 4, 2, { type: 'subtitle', text: 'hello' }),
      ]),
    ], materials);
    expect(spans).toEqual([{ itemId: 'real', trackId: 's', kind: 'subtitle', start: 4, end: 6 }]);
  });

  it('image items on a video track become image spans', () => {
    const spans = collectRenderSpans([
      track('v', 'video', [
        item('clip', 0, 3, { materialId: 'v1' }),
        item('still', 3, 2, { materialId: 'img', originalMaterialType: 'image' }),
      ]),
      track('a', 'audio', [item('music', 0, 60, { materialId: 'a1', type: 'audio' })]),
    ], materials);
    expect(spans.map((span) => span.kind)).toEqual(['video', 'image', 'audio']);
    expect(hasVisualSpan(spans)).toBe(true);
    expect(computeVisualEnd(spans)).toBe(5);
    expect(computeRenderEnd(spans)).toBe(60);
  });

  it('items with a negative start or a non-positive duration are not rendered', () => {
    const spans = collectRenderSpans([
      track('v', 'video', [
        item('negative', -1, 3, { materialId: 'v1' }),
        item('empty', 1, 0, { materialId: 'v1' }),
        item('nan', Number.NaN, 2, { materialId: 'v1' }),
      ]),
    ], materials);
    expect(spans).toEqual([]);
    expect(hasVisualSpan(spans)).toBe(false);
  });
});
