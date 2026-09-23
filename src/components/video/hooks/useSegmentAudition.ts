/**
 * useSegmentAudition — "▶ 试听" on a script segment card (spec §3.5.2).
 *
 * Plays the segment's newest voice-over material as a material-level preview:
 * it never moves the composition playhead. One `HTMLAudioElement` is shared
 * at module level so that only one segment can ever be auditioned at a time,
 * even if several hook instances exist. Audition and the composition never
 * sound together: the composition is paused before audition starts, and the
 * audition stops as soon as the timeline store reports playback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { selectAudioPlaybackUrl } from '@/lib/utils/audioUrl';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import { VideoEditingLogger } from '../utils/logger';

export interface UseSegmentAuditionOptions {
  /** Pauses the composition preview (e.g. `videoPlayerRef.pauseFromTimeline`). */
  onPauseComposition?: () => void;
}

export interface SegmentAudition {
  auditioningSegmentId: string | null;
  play(segmentId: string, voice: MaterialItem): void;
  stop(): void;
}

interface AuditionSession {
  segmentId: string;
  /** Tells the owning hook instance its audition ended. */
  onEnded(): void;
}

let sharedAudio: HTMLAudioElement | null = null;
let activeSession: AuditionSession | null = null;

function getSharedAudio(): HTMLAudioElement {
  if (!sharedAudio) sharedAudio = new Audio();
  return sharedAudio;
}

/** Stops whatever is playing and notifies its owner. */
function endActiveSession(): void {
  const session = activeSession;
  activeSession = null;
  if (sharedAudio) {
    sharedAudio.pause();
    sharedAudio.onended = null;
    sharedAudio.onerror = null;
  }
  session?.onEnded();
}

/** Test seam: drop the module singleton between tests. */
export function resetSegmentAuditionForTests(): void {
  endActiveSession();
  sharedAudio = null;
}

export function useSegmentAudition(options: UseSegmentAuditionOptions = {}): SegmentAudition {
  const { t } = useLocale();
  const { showError } = useNotification();
  const [auditioningSegmentId, setAuditioningSegmentId] = useState<string | null>(null);
  const ownedSessionRef = useRef<AuditionSession | null>(null);
  const pauseRef = useRef(options.onPauseComposition);
  pauseRef.current = options.onPauseComposition;
  const logger = useMemo(
    () => new VideoEditingLogger({ component: 'useSegmentAudition' }),
    [],
  );

  const ownsSession = useCallback(
    (segmentId: string) => activeSession?.segmentId === segmentId,
    [],
  );

  const stop = useCallback(() => {
    if (activeSession) endActiveSession();
    setAuditioningSegmentId(null);
  }, []);

  const fail = useCallback((segmentId: string, error: unknown) => {
    // Log the segment id only — never the media URL (spec §3.5.2).
    logger.error('段落配音试听失败', error instanceof Error ? error : new Error(String(error)), {
      segmentId,
    });
    if (ownsSession(segmentId)) endActiveSession();
    showError(t.workbench.segmentCard.auditionFailed);
  }, [logger, ownsSession, showError, t]);

  const play = useCallback((segmentId: string, voice: MaterialItem) => {
    endActiveSession();
    const url = selectAudioPlaybackUrl(voice);
    if (!url) {
      fail(segmentId, new Error('voice material has no playable url'));
      return;
    }
    pauseRef.current?.();
    const audio = getSharedAudio();
    const session: AuditionSession = {
      segmentId,
      onEnded: () => setAuditioningSegmentId((current) => (current === segmentId ? null : current)),
    };
    activeSession = session;
    ownedSessionRef.current = session;
    audio.onended = () => {
      if (activeSession === session) endActiveSession();
    };
    audio.onerror = () => fail(segmentId, new Error('audio element error'));
    audio.src = url;
    setAuditioningSegmentId(segmentId);
    Promise.resolve(audio.play()).catch((error: unknown) => {
      if (activeSession === session) fail(segmentId, error);
    });
  }, [fail]);

  // Composition starts playing → audition yields immediately.
  useEffect(() => useTimelineStore.subscribe(
    (state) => state.isPlaying,
    (isPlaying) => {
      if (isPlaying) stop();
    },
  ), [stop]);

  // Unmount (panel closed / project switched) stops this instance's audition.
  useEffect(() => () => {
    if (activeSession && activeSession === ownedSessionRef.current) endActiveSession();
  }, []);

  return { auditioningSegmentId, play, stop };
}
