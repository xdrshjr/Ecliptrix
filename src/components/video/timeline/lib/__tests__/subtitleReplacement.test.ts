import { describe, expect, it } from 'vitest';

import type { MaterialItem } from '@/types';
import {
  collectTranscriptionItems,
  getSubtitleCommitBlocker,
  getSubtitleReplacementBlocker,
  type TranscribableTrack,
} from '../subtitleReplacement';

const unlockedTrack = { isLocked: false };

describe('getSubtitleReplacementBlocker', () => {
  it('blocks while extraction is running', () => {
    expect(getSubtitleReplacementBlocker({
      isExtracting: true,
      isConfirmPending: true,
      subtitleTrack: { isLocked: true },
    })).toBe('extracting');
  });

  it('blocks while a replace confirmation is pending', () => {
    expect(getSubtitleReplacementBlocker({
      isExtracting: false,
      isConfirmPending: true,
      subtitleTrack: { isLocked: true },
    })).toBe('confirm-pending');
  });

  it('reports a locked subtitle track', () => {
    expect(getSubtitleReplacementBlocker({
      isExtracting: false,
      isConfirmPending: false,
      subtitleTrack: { isLocked: true },
    })).toBe('track-locked');
  });

  it('allows replacement otherwise', () => {
    expect([
      getSubtitleReplacementBlocker({ isExtracting: false, isConfirmPending: false, subtitleTrack: unlockedTrack }),
      getSubtitleReplacementBlocker({ isExtracting: false, isConfirmPending: false, subtitleTrack: undefined }),
    ]).toEqual([null, null]);
  });
});

describe('getSubtitleCommitBlocker', () => {
  it('blocks while the agent holds the edit lock', () => {
    expect(getSubtitleCommitBlocker({
      externalEditLock: 'agent',
      subtitleTrack: { isLocked: true },
    })).toBe('edit-locked');
  });

  it('reports a subtitle track removed meanwhile', () => {
    expect(getSubtitleCommitBlocker({
      externalEditLock: null,
      subtitleTrack: undefined,
    })).toBe('track-missing');
  });

  it('reports a subtitle track locked meanwhile', () => {
    expect(getSubtitleCommitBlocker({
      externalEditLock: null,
      subtitleTrack: { isLocked: true },
    })).toBe('track-locked');
  });

  it('allows the commit otherwise', () => {
    expect(getSubtitleCommitBlocker({
      externalEditLock: null,
      subtitleTrack: unlockedTrack,
    })).toBeNull();
  });
});

describe('collectTranscriptionItems', () => {
  const voice = {
    id: 'voice', name: 'voice.mp3', type: 'audio', format: 'mp3', size: 1,
    url: '/api/storage/files/audio/voice.mp3', createdAt: new Date(0),
  } as MaterialItem;

  type Clip = TranscribableTrack['items'][number];
  const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({
    id, name: id, type: 'audio', materialId: 'voice', startTime: 5, duration: 4, ...extra,
  });
  const audioTrack = (id: string, items: Clip[], flags: Partial<TranscribableTrack> = {}): TranscribableTrack => ({
    id, type: 'audio', isVisible: true, isMuted: false, items, ...flags,
  });

  it('muted and hidden audio tracks are not transcribed', () => {
    const items = collectTranscriptionItems([
      audioTrack('narration', [clip('heard')]),
      audioTrack('bgm', [clip('muted')], { isMuted: true }),
      audioTrack('hidden', [clip('hidden')], { isVisible: false }),
      { id: 'sub', type: 'subtitle', isVisible: true, isMuted: false, items: [clip('caption', { type: 'subtitle' })] },
    ], [voice]);
    expect(items.map(item => item.id)).toEqual(['heard']);
  });

  it('clip range falls back to clipStart plus duration', () => {
    const items = collectTranscriptionItems([
      audioTrack('narration', [
        clip('trimmed-head', { clipStart: 10 }),
        clip('untrimmed'),
        clip('explicit', { clipStart: 0, clipEnd: 3, duration: 3 }),
      ]),
    ], [voice]);
    expect(items.map(item => [item.clip_start, item.clip_end])).toEqual([[10, 14], [0, 4], [0, 3]]);
  });

  it('sends the timeline position and the resolved local url', () => {
    const [item] = collectTranscriptionItems([audioTrack('narration', [clip('a', { startTime: 7 })])], [voice]);
    expect(item).toMatchObject({
      start_time: 7, duration: 4, track_id: 'narration', url: '/api/storage/files/audio/voice.mp3',
    });
  });

  it('never sends a blob url to the backend', () => {
    const blobOnly = { ...voice, url: 'blob:http://localhost/abc', serverUrl: undefined } as MaterialItem;
    const [item] = collectTranscriptionItems([audioTrack('narration', [clip('a')])], [blobOnly]);
    expect(item.url).toBe('');
  });
});
