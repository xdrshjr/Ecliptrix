import { useState, useCallback, useMemo, useEffect } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { UseTimelineCompositionReturn, VideoSequenceItem, AudioSequenceItem, CompositionPlayback, VideoSeekCallback } from '../types';
import { VideoEditingLogger } from '../utils';
import { CompositionAdapter } from '../timeline/infrastructure';
import type { TrackData, MaterialData } from '../timeline/domain/types';

/**
 * useTimelineComposition Hook
 * 管理时间轴组合播放功能
 *
 * Simplified: sequence extraction logic has been moved to CompositionAdapter
 * in the infrastructure layer. This hook now delegates to that adapter and
 * manages only the React-specific composition playback state.
 *
 * @param taskId - 任务ID，用于日志记录
 * @param materials - 素材列表，用于获取视频URL
 * @param onVideoSeekRequired - 视频播放器跳转回调，用于实时同步timeline变化到视频播放器
 * @returns 时间轴组合播放相关的状态和控制方法
 */
export const useTimelineComposition = (
  taskId: string,
  materials: MaterialItem[],
  onVideoSeekRequired?: VideoSeekCallback
): UseTimelineCompositionReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useTimelineComposition'
  }), [taskId]);

  // Infrastructure adapter for sequence extraction
  const compositionAdapter = useMemo(() => new CompositionAdapter(), []);

  // 组合播放状态
  const [compositionPlayback, setCompositionPlayback] = useState<CompositionPlayback>({
    isCompositionMode: false,
    videoSequences: [],
    audioSequences: [],
    currentSequenceIndex: 0,
    totalCompositionDuration: 0,
    compositionCurrentTime: 0
  });

  // 记录初始化日志
  useEffect(() => {
    logger.info('Timeline Composition Hook初始化', {
      materialsCount: materials.length,
      videoMaterialsCount: materials.filter(m => m.type === 'video').length,
      audioMaterialsCount: materials.filter(m => m.type === 'audio').length
    });
  }, []);

  // 从时间轴状态提取视频序列 — delegates to CompositionAdapter
  const getVideoSequencesFromTimeline = useCallback((timelineState: TimelineState): VideoSequenceItem[] => {
    // Convert TimelineState tracks/materials to domain-compatible shapes
    const tracks = timelineState.tracks as unknown as TrackData[];
    const materialData = materials as unknown as MaterialData[];
    return compositionAdapter.extractVideoSequences(tracks, materialData);
  }, [materials, compositionAdapter]);

  // 从时间轴状态提取音频序列 — delegates to CompositionAdapter
  const getAudioSequencesFromTimeline = useCallback((timelineState: TimelineState): AudioSequenceItem[] => {
    const tracks = timelineState.tracks as unknown as TrackData[];
    const materialData = materials as unknown as MaterialData[];
    return compositionAdapter.extractAudioSequences(tracks, materialData);
  }, [materials, compositionAdapter]);

  // 处理时间轴状态变化
  const handleTimelineStateChange = useCallback((timelineState: TimelineState) => {
    const videoSequences = getVideoSequencesFromTimeline(timelineState);
    const audioSequences = getAudioSequencesFromTimeline(timelineState);
    const totalDuration = videoSequences.reduce((total, seq) => total + seq.duration, 0);

    setCompositionPlayback(prev => {
      // 检查视频和音频序列是否发生变化
      const videoSequencesChanged =
        prev.videoSequences.length !== videoSequences.length ||
        JSON.stringify(prev.videoSequences.map(s => s.id)) !== JSON.stringify(videoSequences.map(s => s.id));

      const audioSequencesChanged =
        prev.audioSequences.length !== audioSequences.length ||
        JSON.stringify(prev.audioSequences.map(s => s.id)) !== JSON.stringify(audioSequences.map(s => s.id));

      const durationChanged = prev.totalCompositionDuration !== totalDuration;

      if (!videoSequencesChanged && !audioSequencesChanged && !durationChanged) {
        return prev; // 返回原状态，避免不必要的更新
      }

      logger.info('时间轴状态变化 - 更新组合播放状态', {
        videoSequencesCount: videoSequences.length,
        audioSequencesCount: audioSequences.length,
        isCompositionMode: videoSequences.length > 0
      });

      return {
        ...prev,
        videoSequences,
        audioSequences,
        totalCompositionDuration: totalDuration,
        isCompositionMode: videoSequences.length > 0,
        currentSequenceIndex: videoSequencesChanged && videoSequences.length > 0 ? 0 : prev.currentSequenceIndex
      };
    });
  }, [getVideoSequencesFromTimeline, getAudioSequencesFromTimeline, logger]);

  // 组合播放控制
  const handleCompositionPlay = useCallback(() => {
    logger.userAction('组合播放开始', 'compositionPlayButton', {
      sequencesCount: compositionPlayback.videoSequences.length,
      totalDuration: compositionPlayback.totalCompositionDuration,
      currentSequenceIndex: compositionPlayback.currentSequenceIndex
    });

    setCompositionPlayback(prev => ({
      ...prev,
      isCompositionMode: true
    }));
  }, [compositionPlayback, logger]);

  // 组合暂停控制
  const handleCompositionPause = useCallback(() => {
    logger.userAction('组合播放暂停', 'compositionPauseButton', {
      currentTime: compositionPlayback.compositionCurrentTime,
      currentSequenceIndex: compositionPlayback.currentSequenceIndex
    });
  }, [compositionPlayback, logger]);

  // 组合时间跳转
  const handleCompositionSeek = useCallback(async (time: number) => {
    const clampedTime = Math.max(0, Math.min(time, compositionPlayback.totalCompositionDuration));

    // 计算当前应该播放的序列索引和视频内时间
    let currentSequenceIndex = 0;
    let accumulatedTime = 0;
    let targetVideoTime = clampedTime;

    for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
      const sequence = compositionPlayback.videoSequences[i];
      if (accumulatedTime + sequence.duration > clampedTime) {
        currentSequenceIndex = i;
        targetVideoTime = clampedTime - accumulatedTime;
        break;
      }
      accumulatedTime += sequence.duration;
      currentSequenceIndex = i + 1;
    }

    // 获取目标序列
    const targetSequence = compositionPlayback.videoSequences[currentSequenceIndex];

    if (onVideoSeekRequired && targetSequence) {
      try {
        await onVideoSeekRequired(clampedTime, targetSequence, targetVideoTime);

        setCompositionPlayback(prev => ({
          ...prev,
          compositionCurrentTime: clampedTime,
          currentSequenceIndex
        }));
      } catch (error) {
        logger.error('视频播放器实时跳转失败', error as Error, {
          compositionTime: clampedTime.toFixed(2)
        });

        setCompositionPlayback(prev => ({
          ...prev,
          compositionCurrentTime: clampedTime,
          currentSequenceIndex
        }));
      }
    } else {
      setCompositionPlayback(prev => ({
        ...prev,
        compositionCurrentTime: clampedTime,
        currentSequenceIndex
      }));
    }
  }, [compositionPlayback, logger, onVideoSeekRequired]);

  // 切换到下一个视频序列
  const handleNextSequence = useCallback(() => {
    if (compositionPlayback.currentSequenceIndex < compositionPlayback.videoSequences.length - 1) {
      const nextIndex = compositionPlayback.currentSequenceIndex + 1;

      logger.info('切换到下一个视频序列', {
        currentIndex: compositionPlayback.currentSequenceIndex,
        nextIndex,
        nextSequence: compositionPlayback.videoSequences[nextIndex]?.name
      });

      setCompositionPlayback(prev => ({
        ...prev,
        currentSequenceIndex: nextIndex
      }));

      return true;
    }

    return false;
  }, [compositionPlayback, logger]);

  // 更新组合播放时间
  const handleCompositionTimeUpdate = useCallback((currentTime: number) => {
    setCompositionPlayback(prev => ({
      ...prev,
      compositionCurrentTime: currentTime
    }));
  }, []);

  // 更新当前序列索引
  const handleSequenceIndexUpdate = useCallback((sequenceIndex: number) => {
    setCompositionPlayback(prev => ({
      ...prev,
      currentSequenceIndex: sequenceIndex
    }));
  }, []);

  return {
    compositionPlayback,
    handleTimelineStateChange,
    handleCompositionPlay,
    handleCompositionPause,
    handleCompositionSeek,
    getVideoSequencesFromTimeline,
    getAudioSequencesFromTimeline,
    handleNextSequence,
    handleCompositionTimeUpdate,
    handleSequenceIndexUpdate
  };
};
