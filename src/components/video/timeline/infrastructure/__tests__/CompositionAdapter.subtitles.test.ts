/**
 * CompositionAdapter — subtitle sequence extraction (spec 02 §2.3 / §5).
 *
 * Subtitle items on visible subtitle tracks with non-empty text are extracted
 * into `SubtitleSequenceItem`s (id/text/startTime/duration/trackId/style),
 * sorted by startTime. Hidden tracks, non-subtitle items, and blank text are
 * skipped. Materials are NOT consulted — text/style live on the item.
 */

import { describe, it, expect } from 'vitest';
import { CompositionAdapter } from '../CompositionAdapter';
import type { TrackData, TimelineItemData } from '../../domain/types';
import type { SubtitleStyle } from '@/types';

const STYLE: SubtitleStyle = {
  fontFamily: 'sans-serif',
  fontSize: 28,
  fontColor: '#ffffff',
  backgroundColor: '#000000',
  position: 'bottom',
};

function subtitleItem(over: Partial<TimelineItemData>): TimelineItemData {
  return {
    id: 'sub-1', name: 'caption', type: 'subtitle', startTime: 0, duration: 2,
    trackId: 'st1', color: '#000000', text: 'hello', ...over,
  };
}

function subtitleTrack(items: TimelineItemData[], over: Partial<TrackData> = {}): TrackData {
  return {
    id: 'st1', name: 'S1', type: 'subtitle', isVisible: true, isLocked: false,
    isMuted: false, volume: 100, height: 40, order: 1, items, ...over,
  };
}

describe('CompositionAdapter.extractSubtitleSequences', () => {
  it('extracts subtitle items with text + style from a visible subtitle track', () => {
    const adapter = new CompositionAdapter();
    const track = subtitleTrack([
      subtitleItem({ id: 'sub-1', text: 'first', startTime: 0, duration: 2, subtitleStyle: STYLE }),
    ]);
    const result = adapter.extractSubtitleSequences([track]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'sub-1',
      text: 'first',
      startTime: 0,
      duration: 2,
      trackId: 'st1',
      style: STYLE,
    });
  });

  it('sorts subtitles by startTime ascending', () => {
    const adapter = new CompositionAdapter();
    const track = subtitleTrack([
      subtitleItem({ id: 'b', text: 'second', startTime: 5, duration: 2 }),
      subtitleItem({ id: 'a', text: 'first', startTime: 1, duration: 2 }),
    ]);
    const result = adapter.extractSubtitleSequences([track]);
    expect(result.map(s => s.id)).toEqual(['a', 'b']);
  });

  it('skips hidden subtitle tracks', () => {
    const adapter = new CompositionAdapter();
    const track = subtitleTrack([subtitleItem({})], { isVisible: false });
    expect(adapter.extractSubtitleSequences([track])).toEqual([]);
  });

  it('skips blank / whitespace-only subtitle items', () => {
    const adapter = new CompositionAdapter();
    const track = subtitleTrack([
      subtitleItem({ id: 'blank', text: '   ' }),
      subtitleItem({ id: 'empty', text: '' }),
      subtitleItem({ id: 'real', text: 'visible' }),
    ]);
    expect(adapter.extractSubtitleSequences([track]).map(s => s.id)).toEqual(['real']);
  });

  it('ignores non-subtitle tracks entirely', () => {
    const adapter = new CompositionAdapter();
    const videoTrack: TrackData = {
      id: 'v1', name: 'V1', type: 'video', isVisible: true, isLocked: false,
      isMuted: false, volume: 100, height: 60, order: 0,
      items: [{ id: 'vi', name: 'clip', type: 'video', startTime: 0, duration: 3, trackId: 'v1', color: '#000' }],
    };
    expect(adapter.extractSubtitleSequences([videoTrack])).toEqual([]);
  });
});
