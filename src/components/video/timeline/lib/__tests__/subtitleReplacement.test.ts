import { describe, expect, it } from 'vitest';

import { getSubtitleCommitBlocker, getSubtitleReplacementBlocker } from '../subtitleReplacement';

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
