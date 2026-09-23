/**
 * Default track names (spec §3.8, RV-04): one function serves the track
 * header, the JSON export and the AI-mix confirmation, so every rule is
 * pinned here once.
 */
import { describe, expect, it } from 'vitest';
import { getTranslations } from '@/lib/i18n';
import { deriveTrackDisplayName, type TrackLike } from '../trackDisplayName';

const zh = getTranslations('zh-CN').timeline.track;
const en = getTranslations('en').timeline.track;

const track = (id: string, overrides: Partial<TrackLike> = {}): TrackLike => ({
  id,
  name: '',
  type: id.split('-')[0],
  ...overrides,
});

const narrationItem = {
  sentenceSegments: {
    sentences: [{ text: '你好', start_time: 0, end_time: 1 }],
    total_duration: 1,
    segment_id: 'seg-1',
  },
};

describe('deriveTrackDisplayName', () => {
  it('first_video_track_named_main_visual', () => {
    expect(deriveTrackDisplayName(track('video-track-1'), zh)).toBe('主画面');
  });

  it('further_video_tracks_named_visual_with_id_number', () => {
    expect(deriveTrackDisplayName(track('video-track-3'), zh)).toBe('画面 3');
  });

  it('audio_track_with_sentence_segments_named_narration', () => {
    const lane = track('audio-track-2', { items: [{}, narrationItem] });
    expect(deriveTrackDisplayName(lane, zh)).toBe('旁白 2');
  });

  it('audio_track_without_sentences_keeps_audio_name', () => {
    const lane = track('audio-track-1', {
      items: [{}, { sentenceSegments: { sentences: [] } }, { sentenceSegments: null }],
    });
    expect(deriveTrackDisplayName(lane, zh)).toBe('音频 1');
  });

  it('narration_detected_from_items_without_extra_param', () => {
    const lane = track('audio-track-1', { items: [narrationItem] });
    expect([
      deriveTrackDisplayName(lane, en),
      deriveTrackDisplayName({ ...lane, items: undefined }, en),
    ]).toEqual(['Narration 1', 'Audio 1']);
  });

  it('image_and_subtitle_tracks_use_short_numbered_names', () => {
    expect([
      deriveTrackDisplayName(track('image-track-1'), zh),
      deriveTrackDisplayName(track('subtitle-track-2'), zh),
    ]).toEqual(['图片 1', '字幕 2']);
  });

  it('custom_name_wins', () => {
    const lane = track('audio-track-1', { name: '  背景音乐 ', items: [narrationItem] });
    expect(deriveTrackDisplayName(lane, zh)).toBe('背景音乐');
  });

  it('unknown_id_prefix_returns_stored_name', () => {
    expect(deriveTrackDisplayName(track('custom-lane', { name: ' ' }), zh)).toBe(' ');
  });
});
