import { describe, expect, it } from 'vitest';
import type { AddSubtitleClipsOperation, TimelineState, Track } from '@/types';
import {
  DEFAULT_AGENT_SUBTITLE_STYLE,
  MAX_TRACK_CUES,
  SUBTITLE_CLIP_COLOR,
  SUBTITLE_TRACK_ID_FALLBACK,
  applySubtitleClipsToState,
  findCueConflicts,
  normalizeSubtitleStyle,
  resolveSubtitleTrack,
  resolveSubtitleTrackId,
  subtitleClipName,
  subtitleStyleProblem,
} from '../subtitleClips';

/**
 * 字幕纯函数层（agent-subtitles spec §6.3 / §9.1）。
 *
 * 这一层是「服务端本地副本」与「浏览器真实时间线」的唯一实现（D-4），所以它
 * 自己必须先钉死：建轨、upsert、排序、`totalDuration`、颜色来源、id 稳定性。
 */

function emptyState(): TimelineState {
  return {
    currentTime: 0, totalDuration: 10, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 1, scrollLeft: 0,
  };
}

function videoTrack(): Track {
  return {
    id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0,
    items: [{
      id: 'a', name: 'a', type: 'video', startTime: 0, duration: 4,
      trackId: 'v1', color: '#000',
    }],
  };
}

function operation(
  clips: AddSubtitleClipsOperation['clips'],
  overrides: Partial<AddSubtitleClipsOperation> = {},
): AddSubtitleClipsOperation {
  return {
    type: 'add_subtitle_clips',
    trackId: SUBTITLE_TRACK_ID_FALLBACK,
    mode: 'append',
    style: DEFAULT_AGENT_SUBTITLE_STYLE,
    clips,
    ...overrides,
  };
}

function cue(id: string, text: string, startTime: number, duration = 1.5) {
  return { id, name: text.slice(0, 20), text, startTime, duration };
}

describe('subtitle style', () => {
  it('uses the manual UI default preset field by field (D-3)', () => {
    expect(DEFAULT_AGENT_SUBTITLE_STYLE).toEqual({
      fontFamily: 'default', fontSize: 60, fontColor: '#FFFFFF', position: 'bottom',
    });
    expect(normalizeSubtitleStyle()).toEqual(DEFAULT_AGENT_SUBTITLE_STYLE);
  });

  it('keeps given fields and only adds the missing ones', () => {
    expect(normalizeSubtitleStyle({ fontSize: 36, backgroundColor: '#000000' }))
      .toEqual({ ...DEFAULT_AGENT_SUBTITLE_STYLE, fontSize: 36, backgroundColor: '#000000' });
  });

  it('refuses out-of-range or unknown values (V9)', () => {
    expect(subtitleStyleProblem({ fontSize: 4 })).toContain('fontSize');
    expect(subtitleStyleProblem({ fontSize: 90 })).toContain('fontSize');
    expect(subtitleStyleProblem({ position: 'middle' })).toContain('position');
    expect(subtitleStyleProblem({ fontFamily: 'comic' })).toContain('fontFamily');
    expect(subtitleStyleProblem({ fontColor: 'white' })).toContain('fontColor');
    expect(subtitleStyleProblem({ backgroundColor: '#12345' })).toContain('backgroundColor');
    expect(subtitleStyleProblem({})).toBeNull();
  });
});

describe('resolveSubtitleTrackId', () => {
  it('falls back to subtitle-track-1 when no subtitle track exists', () => {
    const state = emptyState();
    state.tracks.push(videoTrack());
    expect(resolveSubtitleTrackId(state)).toBe(SUBTITLE_TRACK_ID_FALLBACK);
  });

  it('reuses the first existing subtitle track', () => {
    const state = emptyState();
    state.tracks.push(videoTrack());
    state.tracks.push({
      id: 'subtitle-track-7', name: '', type: 'subtitle', height: 50,
      isLocked: false, isMuted: false, isVisible: true, volume: 100,
      order: 1, items: [],
    });
    expect(resolveSubtitleTrack(state)?.id).toBe('subtitle-track-7');
    expect(resolveSubtitleTrackId(state)).toBe('subtitle-track-7');
  });

  it('does not collide with an id already taken by another track', () => {
    const state = emptyState();
    state.tracks.push({ ...videoTrack(), id: SUBTITLE_TRACK_ID_FALLBACK });
    expect(resolveSubtitleTrackId(state)).toBe('subtitle-track-2');
  });

  it('honours an explicit trackId', () => {
    expect(resolveSubtitleTrackId(emptyState(), 'my-subs')).toBe('my-subs');
  });
});

describe('applySubtitleClipsToState', () => {
  it('creates the subtitle track with the render-critical fields (D-14)', () => {
    const state = emptyState();
    state.tracks.push(videoTrack());
    applySubtitleClipsToState(state, operation([cue('s1', '你好', 1)]));

    const track = state.tracks.find(item => item.id === SUBTITLE_TRACK_ID_FALLBACK);
    expect(track).toMatchObject({
      type: 'subtitle', height: 50, isVisible: true, isLocked: false,
      order: 1, // appended after the video track
      name: '',
    });
    const item = track?.items[0];
    expect(item).toMatchObject({
      id: 's1', type: 'subtitle', text: '你好', startTime: 1, duration: 1.5,
      trackId: SUBTITLE_TRACK_ID_FALLBACK, color: SUBTITLE_CLIP_COLOR,
      subtitleStyle: DEFAULT_AGENT_SUBTITLE_STYLE,
    });
    // 字幕没有素材：这三个字段一写就会让「素材缺失」判断误伤。
    expect(item?.materialId).toBeUndefined();
    expect(item?.url).toBeUndefined();
    expect(item?.originalDuration).toBeUndefined();
  });

  it('keeps cues in start-time order regardless of input order', () => {
    const state = emptyState();
    applySubtitleClipsToState(state, operation([
      cue('s3', 'c', 4), cue('s1', 'a', 0), cue('s2', 'b', 2),
    ]));
    const items = state.tracks[0].items;
    expect(items.map(item => item.id)).toEqual(['s1', 's2', 's3']);
  });

  it('upserts by id instead of pushing a duplicate (D-15)', () => {
    const state = emptyState();
    const op = operation([cue('s1', '旧文本', 1)]);
    applySubtitleClipsToState(state, op);
    applySubtitleClipsToState(state, operation([cue('s1', '新文本', 2, 3)]));

    const items = state.tracks[0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: '新文本', startTime: 2, duration: 3 });
  });

  it('clears the whole track in replace mode', () => {
    const state = emptyState();
    applySubtitleClipsToState(state, operation([cue('s1', '旧1', 0), cue('s2', '旧2', 3)]));
    applySubtitleClipsToState(state, operation([cue('s9', '新', 5)], { mode: 'replace' }));

    const items = state.tracks[0].items;
    expect(items.map(item => item.id)).toEqual(['s9']);
  });

  it('raises totalDuration itself so a subtitle past the end still extends it (P0-2)', () => {
    const state = emptyState();
    state.tracks.push(videoTrack()); // video ends at 4, totalDuration says 10
    state.totalDuration = 4;
    applySubtitleClipsToState(state, operation([cue('s1', '尾巴', 30, 2)]));
    expect(state.totalDuration).toBe(32);
  });
});

describe('findCueConflicts', () => {
  it('returns null when cues merely touch', () => {
    const cues = [cue('s1', 'a', 0, 2), cue('s2', 'b', 2, 2)];
    expect(findCueConflicts([], cues)).toBeNull();
  });

  it('reports a batch-internal overlap with both indices', () => {
    const cues = [cue('s1', 'a', 0, 2), cue('s2', 'b', 1, 2)];
    expect(findCueConflicts([], cues)).toMatchObject({
      index: 1, previousIndex: 0, overlapStart: 1, overlapEnd: 2,
    });
  });

  it('reports a conflict with an existing item on the track', () => {
    const existing = [{
      id: 'old', name: 'old', type: 'subtitle' as const, startTime: 1,
      duration: 2, trackId: 'subtitle-track-1', color: '#000', text: '旧字幕',
    }];
    expect(findCueConflicts(existing, [cue('s1', '新', 2, 2)])).toMatchObject({
      index: 0, existingIndex: 0, existingText: '旧字幕', overlapStart: 2, overlapEnd: 3,
    });
  });
});

describe('subtitle helpers', () => {
  it('derives the track label from the first 20 characters', () => {
    expect(subtitleClipName('  一二三四五六七八九十一二三四五六七八九十多余  '))
      .toHaveLength(20);
  });

  it('takes the clip colour from TrackType, never from CLIP_COLORS (D-16)', () => {
    expect(SUBTITLE_CLIP_COLOR).toBe('#E67E22');
  });

  it('caps a single track at 1000 cues (D-17)', () => {
    expect(MAX_TRACK_CUES).toBe(1000);
  });
});
