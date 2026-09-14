/**
 * UI3-12 — the compositor's play state is mirrored into the timeline store, so
 * the ruler's "Playing" badge (`TimelineRuler` reads `state.isPlaying`) follows
 * preview playback and never stays on after the panel unmounts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTimelineStore } from '../../../timeline/store';
import { usePlayStateMirror } from '../usePlayStateMirror';

describe('usePlayStateMirror (UI3-12)', () => {
  beforeEach(() => {
    useTimelineStore.getState().setPlaying(false);
  });

  it('the ruler shows Playing while the compositor plays', () => {
    const { rerender, unmount } = renderHook(
      ({ playing }: { playing: boolean }) => usePlayStateMirror(playing),
      { initialProps: { playing: true } },
    );
    const whilePlaying = useTimelineStore.getState().isPlaying;
    rerender({ playing: false });
    const afterPause = useTimelineStore.getState().isPlaying;
    rerender({ playing: true });
    unmount();
    const afterUnmount = useTimelineStore.getState().isPlaying;

    expect({ whilePlaying, afterPause, afterUnmount }).toEqual({
      whilePlaying: true,
      afterPause: false,
      afterUnmount: false,
    });
  });
});
