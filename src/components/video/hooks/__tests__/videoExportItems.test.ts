import { describe, expect, it } from 'vitest';
import type { MaterialItem, TimelineItem, Track } from '@/types';
import {
  buildExportCompositionItems,
  planVideoExport,
  toImageCompositionItem,
  toSubtitleCompositionItem,
} from '../videoExportItems';

function material(id: string, type: MaterialItem['type']): MaterialItem {
  return {
    id,
    name: id,
    type,
    format: type === 'image' ? 'png' : 'mp4',
    size: 1,
    url: `/api/storage/files/${type}/${id}`,
    createdAt: new Date(0),
  };
}

function item(id: string, patch: Partial<TimelineItem> = {}): TimelineItem {
  return { id, name: id, type: 'video', startTime: 0, duration: 2, trackId: 't', color: '#000', ...patch };
}

function track(id: string, type: Track['type'], items: TimelineItem[], order = 0): Track {
  return {
    id, name: id, type, height: 60, isLocked: false, isMuted: false, isVisible: true,
    volume: 100, items, order,
  };
}

const byId = (materials: MaterialItem[]) => new Map(materials.map((m) => [m.id, m]));

describe('videoExportItems', () => {
  it('skips subtitles with empty text instead of exporting the item name', () => {
    const subtitleTrack = track('s', 'subtitle', []);
    expect(toSubtitleCompositionItem(item('Subtitle 1', { type: 'subtitle', text: '  ' }), subtitleTrack)).toBeNull();
    expect(toSubtitleCompositionItem(item('Subtitle 2', { type: 'subtitle' }), subtitleTrack)).toBeNull();
    expect(toSubtitleCompositionItem(item('Subtitle 3', { type: 'subtitle', text: 'hi' }), subtitleTrack)?.text).toBe('hi');
  });

  it('omits the background when the style has none', () => {
    const exported = toSubtitleCompositionItem(
      item('s1', {
        type: 'subtitle',
        text: 'caption',
        subtitleStyle: { fontFamily: 'serif', fontSize: 40, fontColor: '#FF0000', position: 'top' },
      }),
      track('s', 'subtitle', []),
    );
    expect(exported).toMatchObject({ font_size: 40, font_color: '#FF0000', position: 'top' });
    expect(exported?.background_color).toBeUndefined();
    const unstyled = toSubtitleCompositionItem(item('s2', { type: 'subtitle', text: 'x' }), track('s', 'subtitle', []));
    expect(unstyled?.background_color).toBeUndefined();
  });

  it('exports image opacity 0 as 0', () => {
    const exported = toImageCompositionItem(
      item('img', { opacity: 0, originalMaterialType: 'image' }),
      track('v', 'video', []),
      material('pic', 'image'),
    );
    expect(exported.opacity).toBe(0);
  });

  it('keeps track order instead of sorting images by start time', () => {
    const materials = byId([material('pic', 'image')]);
    const result = buildExportCompositionItems(
      [
        track('upper', 'video', [item('late', { startTime: 8, materialId: 'pic', originalMaterialType: 'image' })], 1),
        track('lower', 'video', [item('early', { startTime: 1, materialId: 'pic', originalMaterialType: 'image' })], 0),
      ],
      materials,
    );
    expect(result.imageItems.map((entry) => entry.id)).toEqual(['late', 'early']);
  });

  it('clamps an image zIndex into 0..999', () => {
    const exported = toImageCompositionItem(
      item('img', { imagePosition: { x: 0, y: 0, width: 1, height: 1, zIndex: 5000 } }),
      track('v', 'video', []),
      material('pic', 'image'),
    );
    expect(exported.position.zIndex).toBe(999);
  });

  it('does not send items the preview does not render', () => {
    // A negative start or zero length is refused by the backend model (422 for
    // the whole export); an audio material on a video track is skipped by the
    // preview but used to be sent as a video clip.
    const result = buildExportCompositionItems(
      [
        track('v', 'video', [
          item('kept', { materialId: 'clip' }),
          item('negative-start', { materialId: 'clip', startTime: -1 }),
          item('zero-length', { materialId: 'clip', startTime: 3, duration: 0 }),
          item('audio-on-video-track', { materialId: 'voice', startTime: 4 }),
        ]),
      ],
      byId([material('clip', 'video'), material('voice', 'audio')]),
    );
    expect(result.videoItems.map((entry) => entry.id)).toEqual(['kept']);
  });

  it('plans a missing material before the nothing-visible check', () => {
    const plan = planVideoExport(
      [track('v', 'video', [item('Clip A', { materialId: 'deleted' })])],
      byId([]),
    );
    expect(plan).toEqual({ status: 'missing-materials', clips: [{ itemId: 'Clip A', name: 'Clip A' }] });
  });
});
