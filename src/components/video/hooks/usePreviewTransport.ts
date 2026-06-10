import { useCallback, useMemo, useState } from 'react';
import { UseVideoPlaybackReturn, PreviewQuality } from '../types';
import { formatTimelineTime } from '@/components/video/timeline/timeFormat';

/**
 * usePreviewTransport — preview-mode transport state for the video editor.
 *
 * local-video-editing-refactor S4: replaces the deleted `useVideoPlayback`
 * (which carried the v1 mock-simulator interval gated on the removed
 * playback-v2 flag). The multi-track compositor (`useCompositionPlayback`) is
 * now the sole driver of composition playback, so this hook only owns the
 * lightweight preview-mode state the player CONTROLS still read: master volume,
 * play/seek state for the empty-timeline preview placeholder, and `formatTime`.
 * It no longer simulates a clock — composition time comes from the engine.
 *
 * @param onTimeUpdate - time-update callback (parity with the old signature;
 *   preview mode has no clock to drive it now, so it is unused but kept so the
 *   call site stays binary-stable).
 * @param currentTimelineTime - the timeline cursor, used to seed preview play.
 * @param externalTrackVolume - track-derived volume; folds into effectiveVolume.
 */
export const usePreviewTransport = (
  _taskId: string,
  _onTimeUpdate?: (currentTime: number) => void,
  currentTimelineTime?: number,
  externalTrackVolume?: number,
): UseVideoPlaybackReturn => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.8);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>('high');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVolumeSlider] = useState(false);

  // Effective volume = track volume × master volume (track defaults to 1.0).
  const trackVolume = externalTrackVolume !== undefined ? externalTrackVolume : 1.0;
  const effectiveVolume = trackVolume * masterVolume;

  const handlePlayPause = useCallback(() => {
    const next = !isPlaying;
    // Starting playback from the timeline cursor: seed currentTime from it.
    if (
      next &&
      currentTimelineTime !== undefined &&
      Math.abs(currentTimelineTime - currentTime) > 0.05
    ) {
      setCurrentTime(currentTimelineTime);
    }
    setIsPlaying(next);
  }, [isPlaying, currentTime, currentTimelineTime]);

  const handleTimeSeek = useCallback((newTime: number) => {
    setCurrentTime(Math.max(0, newTime));
  }, []);

  const handleVolumeChange = useCallback((newVolume: number) => {
    setMasterVolume(Math.max(0, Math.min(1, newVolume)));
  }, []);

  const handlePlaybackRateChange = useCallback((rate: number) => {
    setPlaybackRate(rate);
  }, []);

  const handleQualityChange = useCallback((quality: PreviewQuality) => {
    setPreviewQuality(quality);
  }, []);

  const handleFullscreenToggle = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const formatTime = useCallback(
    (seconds: number) => formatTimelineTime(seconds, { showMs: false }),
    [],
  );

  return useMemo<UseVideoPlaybackReturn>(
    () => ({
      isPlaying,
      currentTime,
      volume: masterVolume,
      effectiveVolume,
      playbackRate,
      previewQuality,
      isFullscreen,
      showVolumeSlider,
      handlePlayPause,
      handleTimeSeek,
      handleVolumeChange,
      handlePlaybackRateChange,
      handleQualityChange,
      handleFullscreenToggle,
      formatTime,
    }),
    [
      isPlaying,
      currentTime,
      masterVolume,
      effectiveVolume,
      playbackRate,
      previewQuality,
      isFullscreen,
      showVolumeSlider,
      handlePlayPause,
      handleTimeSeek,
      handleVolumeChange,
      handlePlaybackRateChange,
      handleQualityChange,
      handleFullscreenToggle,
      formatTime,
    ],
  );
};
