/**
 * Mirror the compositor's play state into the timeline store (UI3-12).
 *
 * The compositor owns playback; the ruler's "Playing" badge and the
 * follow-playhead hook read the store's `isPlaying`. `setPlaying` is view state
 * (no history, not part of the timeline shape). Reset on unmount so a closed
 * panel never leaves the timeline marked as playing.
 */

import { useEffect } from 'react';
import { useTimelineStore } from '../../timeline/store';

export function usePlayStateMirror(isPlaying: boolean): void {
  useEffect(() => {
    useTimelineStore.getState().setPlaying(isPlaying);
  }, [isPlaying]);

  useEffect(() => () => useTimelineStore.getState().setPlaying(false), []);
}
