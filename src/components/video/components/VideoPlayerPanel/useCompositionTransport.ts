'use client';

/**
 * useCompositionTransport — preview transport for VideoPlayerPanel.
 *
 * Extracted from VideoPlayerPanel (D10 split, S4). Owns the readiness gate +
 * all play / pause / seek control flow + the imperative `VideoPlayerPanelRef`
 * the parent (VideoEditingInterface) drives. Transport is PROP-DRIVEN into the
 * compositor: this hook only flips `isCompositionPlaying` and calls
 * `compositionPreview.seek(t)` — the {@link useCompositionPlayback} engine
 * repaints. No `<video>` is manipulated here (the v1 player was removed in S4).
 *
 * Pure decision logic (the readiness gate) is exported as
 * {@link computeMediaReadiness} so it is jsdom-testable without React.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ForwardedRef,
} from 'react';
import type { TimelineState, MaterialItem } from '@/types';
import type { CompositionPlayback, VideoSequenceItem } from '../../types';
import { findSequenceAtCompositionTime } from '../../utils/timelineMapping';
import { canPreviewDirectLocalMaterial } from '../../lib/localMaterial';
import type { VideoPlayerPanelRef } from './VideoPlayerPanel';
import type { UseCompositionPlaybackReturn } from '../../hooks/useCompositionPlayback';

export type PlaybackMode = 'composition' | 'preview';

/** Progress bar fill in [0, 100]; 0 for an empty or unknown duration (N-06). */
export function computeProgressPercent(currentTime: number, totalDuration: number): number {
  if (!(totalDuration > 0)) return 0;
  return Math.min(100, Math.max(0, (currentTime / totalDuration) * 100));
}

export interface MediaReadiness {
  allReady: boolean;
  readyCount: number;
  gatingCount: number;
  degradedCount: number;
  totalCount: number;
}

/**
 * Round-2 readiness gate (spec §3.3.6). Walk the timeline's video/audio items
 * (C2: image/subtitle excluded) and check each referenced material's
 * `localProxyStatus`. Satisfied when every such material is `ready` (locally
 * downloaded) OR terminally `degraded` (C3: streams — must NOT block). When the
 * flag is off the gate is always open (round-1 streaming preview). Pure.
 */
export function computeMediaReadiness(
  localPreviewEnabled: boolean,
  materials: readonly MaterialItem[] | undefined,
  timelineState: TimelineState | undefined,
): MediaReadiness {
  if (!localPreviewEnabled) {
    return { allReady: true, readyCount: 0, gatingCount: 0, degradedCount: 0, totalCount: 0 };
  }
  const byId = new Map((materials || []).map((m) => [m.id, m] as const));
  let total = 0;
  let ready = 0;
  let gating = 0;
  let degraded = 0;
  (timelineState?.tracks ?? []).forEach((track) => {
    (track.items ?? []).forEach((item) => {
      if (!item.materialId) return;
      const m = byId.get(item.materialId);
      if (!m) return; // material not loaded — cannot be gated on
      // C2 — gate on the MATERIAL type, not the timeline item type.
      if (m.type !== 'video' && m.type !== 'audio') return;
      total += 1;
      if (canPreviewDirectLocalMaterial(m)) {
        ready += 1;
        return;
      }
      const status = m.localProxyStatus;
      if (status === 'ready') {
        ready += 1;
      } else if (status === 'degraded') {
        degraded += 1; // resolved — streams, does not block (C3)
      } else {
        gating += 1; // idle / transcoding / downloading / error → blocks
      }
    });
  });
  return {
    allReady: gating === 0,
    readyCount: ready,
    gatingCount: gating,
    degradedCount: degraded,
    totalCount: total,
  };
}

export interface UseCompositionTransportOptions {
  ref: ForwardedRef<VideoPlayerPanelRef>;
  playbackMode: PlaybackMode;
  compositionPlayback: CompositionPlayback | undefined;
  compositionPreview: UseCompositionPlaybackReturn;
  /** Preview-mode play state (from usePreviewTransport). */
  isPlaying: boolean;
  /** Preview-mode cursor (from usePreviewTransport). */
  currentTime: number;
  isCompositionPlaying: boolean;
  setIsCompositionPlaying: (v: boolean) => void;
  compositionCurrentTime: number;
  updateCompositionCurrentTime: (t: number) => void;
  timelineState?: TimelineState;
  materials?: MaterialItem[];
  localPreviewEnabled: boolean;
  /** Show the "materials downloading" toast (one call per blocked play). */
  surfaceMaterialsDownloading: (readiness: MediaReadiness) => void;
  // Parent callbacks.
  onCompositionPlayPause?: () => void;
  onCompositionSeek?: (time: number) => void;
  onSequenceIndexUpdate?: (sequenceIndex: number) => void;
  // Preview-mode transport (from usePreviewTransport).
  handlePlayPause: () => void;
  handleTimeSeek: (time: number) => void;
}

export interface UseCompositionTransportReturn {
  handlePlayPauseClick: () => Promise<void>;
  handleTimeSeekClick: (newTime: number) => Promise<void>;
  getCurrentTime: () => number;
  getTotalDuration: () => number;
  getCurrentlyPlaying: () => boolean;
  allTimelineMediaReady: boolean;
}

/**
 * Wire the preview transport + the imperative `VideoPlayerPanelRef` handle.
 */
export function useCompositionTransport(
  options: UseCompositionTransportOptions,
): UseCompositionTransportReturn {
  const {
    ref,
    playbackMode,
    compositionPlayback,
    compositionPreview,
    isPlaying,
    currentTime,
    isCompositionPlaying,
    setIsCompositionPlaying,
    compositionCurrentTime,
    updateCompositionCurrentTime,
    timelineState,
    materials,
    localPreviewEnabled,
    surfaceMaterialsDownloading,
    onCompositionPlayPause,
    onCompositionSeek,
    onSequenceIndexUpdate,
    handlePlayPause,
    handleTimeSeek,
  } = options;

  // Latest compositor handle through a ref so the heavily-memoised callbacks do
  // not re-create when the hook return identity changes each render.
  const compositionPreviewRef = useRef(compositionPreview);
  compositionPreviewRef.current = compositionPreview;

  // Play-state ref for event callbacks (avoid stale closure reads).
  const isCompositionPlayingRef = useRef(false);
  useEffect(() => { isCompositionPlayingRef.current = isCompositionPlaying; }, [isCompositionPlaying]);

  const mediaReadiness = useMemo(
    () => computeMediaReadiness(localPreviewEnabled, materials, timelineState),
    [localPreviewEnabled, materials, timelineState],
  );
  const allTimelineMediaReady = mediaReadiness.allReady;
  // Mirror into refs so the memoised handlers read the latest readiness without
  // being added to their dependency arrays.
  const allTimelineMediaReadyRef = useRef(allTimelineMediaReady);
  allTimelineMediaReadyRef.current = allTimelineMediaReady;
  const mediaReadinessRef = useRef(mediaReadiness);
  mediaReadinessRef.current = mediaReadiness;

  const gatePlay = useCallback((): boolean => {
    if (allTimelineMediaReadyRef.current) return true;
    surfaceMaterialsDownloading(mediaReadinessRef.current);
    return false;
  }, [surfaceMaterialsDownloading]);

  // 处理播放/暂停点击
  const handlePlayPauseClick = useCallback(async () => {
    const wantsToPlay = !(playbackMode === 'composition' ? isCompositionPlaying : isPlaying);
    if (wantsToPlay && !gatePlay()) return;

    if (playbackMode === 'composition') {
      const next = !isCompositionPlaying;
      isCompositionPlayingRef.current = next;
      setIsCompositionPlaying(next);
      if (onCompositionPlayPause) onCompositionPlayPause();
    } else {
      handlePlayPause();
    }
  }, [playbackMode, isCompositionPlaying, isPlaying, gatePlay, setIsCompositionPlaying, onCompositionPlayPause, handlePlayPause]);

  // 核心组合播放跳转。时间驱动：把目标合成时间 seek 到合成器（它逐帧解析活动 clip）。
  const handleCompositionSeek = useCallback(async (
    compositionTime: number,
    targetSequence: VideoSequenceItem,
    _videoTime: number,
    source: 'timeline' | 'player' = 'player',
  ) => {
    if (!compositionPlayback) return;
    const targetSequenceIndex = compositionPlayback.videoSequences.findIndex(s => s.id === targetSequence.id);
    if (
      onSequenceIndexUpdate &&
      targetSequenceIndex >= 0 &&
      targetSequenceIndex !== compositionPlayback.currentSequenceIndex
    ) {
      onSequenceIndexUpdate(targetSequenceIndex);
    }
    updateCompositionCurrentTime(compositionTime);
    compositionPreviewRef.current.seek(compositionTime);
    if (onCompositionSeek && source === 'player') {
      onCompositionSeek(compositionTime);
    }
  }, [compositionPlayback, onSequenceIndexUpdate, onCompositionSeek, updateCompositionCurrentTime]);

  // 处理时间跳转（进度条）
  const handleTimeSeekClick = useCallback(async (newTime: number) => {
    if (playbackMode === 'composition' && compositionPlayback) {
      const target = findSequenceAtCompositionTime(compositionPlayback.videoSequences, newTime);
      const targetSequence = target?.sequence;
      const targetVideoTime = target?.offset ?? 0;
      if (targetSequence) {
        await handleCompositionSeek(newTime, targetSequence, targetVideoTime, 'player');
      } else {
        updateCompositionCurrentTime(newTime);
        compositionPreviewRef.current.seek(newTime);
      }
    } else {
      handleTimeSeek(newTime);
    }
  }, [playbackMode, compositionPlayback, handleCompositionSeek, handleTimeSeek, updateCompositionCurrentTime]);

  const getTotalDuration = useCallback(() => {
    if (playbackMode === 'composition') {
      return compositionPlayback?.totalCompositionDuration || 0;
    }
    const hasItems = timelineState?.tracks?.some(t => t.items && t.items.length > 0);
    if (!hasItems) return 0;
    return timelineState?.totalDuration || 0;
  }, [playbackMode, compositionPlayback, timelineState]);

  // N-06: the store playhead may sit past the render end (hidden tracks, blank
  // subtitles count there); the preview shows the last frame, so report that.
  const getCurrentTime = useCallback(() => {
    if (playbackMode !== 'composition') return currentTime;
    const total = compositionPlayback?.totalCompositionDuration || 0;
    return total > 0 ? Math.min(compositionCurrentTime, total) : compositionCurrentTime;
  }, [playbackMode, compositionPlayback, compositionCurrentTime, currentTime]);

  const getCurrentlyPlaying = useCallback(
    () => (playbackMode === 'composition' ? isCompositionPlaying : isPlaying),
    [playbackMode, isCompositionPlaying, isPlaying],
  );

  // 暂停（不 seek）。
  const pauseFromTimeline = useCallback(async () => {
    if (playbackMode === 'composition' && compositionPlayback) {
      isCompositionPlayingRef.current = false;
      setIsCompositionPlaying(false);
      if (onCompositionPlayPause) onCompositionPlayPause();
    } else if (isPlaying) {
      await handlePlayPauseClick();
    }
  }, [playbackMode, compositionPlayback, setIsCompositionPlaying, onCompositionPlayPause, isPlaying, handlePlayPauseClick]);

  // 从 timeline 游标位置开始播放。seek 到目标合成时间后开始播放（prop-driven）。
  const seekAndPlayFromTimeline = useCallback(async (timelineTime: number) => {
    // This imperative entry is reached by the global spacebar handler +
    // timeline-click-to-play, BYPASSING the play button. Enforce the same gate.
    if (!gatePlay()) return;

    if (playbackMode === 'composition' && compositionPlayback) {
      const target = findSequenceAtCompositionTime(compositionPlayback.videoSequences, timelineTime);
      const targetSequenceIndex = target?.index ?? 0;
      if (compositionPlayback.currentSequenceIndex !== targetSequenceIndex && onSequenceIndexUpdate) {
        onSequenceIndexUpdate(targetSequenceIndex);
      }
      updateCompositionCurrentTime(timelineTime);
      compositionPreviewRef.current.seek(timelineTime);
      isCompositionPlayingRef.current = true;
      setIsCompositionPlaying(true);
      if (onCompositionPlayPause) onCompositionPlayPause();
    } else {
      // 预览模式：先 seek 再启动播放。preview 模式下当前时间即 currentTime。
      if (Math.abs(timelineTime - currentTime) > 0.05) {
        handleTimeSeek(timelineTime);
      }
      if (!isPlaying) {
        await handlePlayPauseClick();
      }
    }
  }, [
    gatePlay,
    playbackMode,
    compositionPlayback,
    onSequenceIndexUpdate,
    onCompositionPlayPause,
    updateCompositionCurrentTime,
    setIsCompositionPlaying,
    handleTimeSeek,
    handlePlayPauseClick,
    isPlaying,
    currentTime,
  ]);

  // isPlaying() 读取所用的 ref：mirror 当前播放态，避免 closure 内拿到旧 render 的值。
  const isPlayingForRefRef = useRef(false);
  useEffect(() => {
    isPlayingForRefRef.current = playbackMode === 'composition' ? isCompositionPlaying : isPlaying;
  }, [playbackMode, isCompositionPlaying, isPlaying]);
  const isPlayingForRef = useCallback(() => isPlayingForRefRef.current, []);

  /**
   * @deprecated 旧入口，保留一个版本周期。新代码应通过 isPlaying() 选择
   * seekAndPlayFromTimeline 或 pauseFromTimeline。
   */
  const handlePlayPauseFromTimeline = useCallback(async (timelineTime: number) => {
    if (isPlayingForRefRef.current) {
      await pauseFromTimeline();
    } else {
      await seekAndPlayFromTimeline(timelineTime);
    }
  }, [pauseFromTimeline, seekAndPlayFromTimeline]);

  // 通过ref暴露方法给父组件
  useImperativeHandle(ref, () => ({
    handleCompositionSeek,
    seekAndPlayFromTimeline,
    pauseFromTimeline,
    isPlaying: isPlayingForRef,
    handlePlayPauseFromTimeline,
  }), [handleCompositionSeek, seekAndPlayFromTimeline, pauseFromTimeline, isPlayingForRef, handlePlayPauseFromTimeline]);

  return {
    handlePlayPauseClick,
    handleTimeSeekClick,
    getCurrentTime,
    getTotalDuration,
    getCurrentlyPlaying,
    allTimelineMediaReady,
  };
}
