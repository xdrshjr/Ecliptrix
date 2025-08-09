import { useState, useCallback, useMemo, useEffect } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { UseTimelineCompositionReturn, VideoSequenceItem, CompositionPlayback } from '../types';
import { VideoEditingLogger } from '../utils';

/**
 * useTimelineComposition Hook
 * 管理时间轴组合播放功能
 * 
 * @param taskId - 任务ID，用于日志记录
 * @param materials - 素材列表，用于获取视频URL
 * @returns 时间轴组合播放相关的状态和控制方法
 */
export const useTimelineComposition = (
  taskId: string,
  materials: MaterialItem[]
): UseTimelineCompositionReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useTimelineComposition'
  }), [taskId]);

  // 组合播放状态
  const [compositionPlayback, setCompositionPlayback] = useState<CompositionPlayback>({
    isCompositionMode: false,
    videoSequences: [],
    currentSequenceIndex: 0,
    totalCompositionDuration: 0,
    compositionCurrentTime: 0
  });

  // 记录初始化日志
  useEffect(() => {
    logger.info('Timeline Composition Hook初始化', {
      materialsCount: materials.length,
      videoMaterialsCount: materials.filter(m => m.type === 'video').length
    });
  }, []);

  // 从时间轴状态提取视频序列
  const getVideoSequencesFromTimeline = useCallback((timelineState: TimelineState): VideoSequenceItem[] => {
    logger.info('从时间轴提取视频序列', {
      tracksCount: timelineState.tracks.length,
      totalDuration: timelineState.totalDuration
    });

    // 收集所有视频轨道的视频项目
    const allVideoItems: VideoSequenceItem[] = [];
    
    timelineState.tracks.forEach(track => {
      if (track.type === 'video' && track.isVisible && !track.isLocked) {
        track.items.forEach(item => {
          if (item.type === 'video' && item.materialId) {
            // 找到对应的素材
            const material = materials.find(m => m.id === item.materialId);
            if (material && material.type === 'video') {
              const videoSequence: VideoSequenceItem = {
                id: item.id,
                name: item.name,
                url: material.url,
                startTime: item.startTime,
                duration: item.duration,
                thumbnailUrl: item.thumbnailUrl || material.thumbnailUrl,
                materialId: item.materialId,
                trackId: item.trackId
              };
              allVideoItems.push(videoSequence);
              
              logger.info('添加视频序列项目', {
                itemId: item.id,
                itemName: item.name,
                startTime: item.startTime,
                duration: item.duration,
                materialUrl: material.url,
                trackId: item.trackId
              });
            }
          }
        });
      }
    });

    // 按开始时间排序
    const sortedVideoItems = allVideoItems.sort((a, b) => a.startTime - b.startTime);
    
    logger.info('视频序列提取完成', {
      totalVideoSequences: sortedVideoItems.length,
      sequences: sortedVideoItems.map(seq => ({
        id: seq.id,
        name: seq.name,
        startTime: seq.startTime,
        duration: seq.duration
      }))
    });

    return sortedVideoItems;
  }, [materials, logger]);

  // 处理时间轴状态变化
  const handleTimelineStateChange = useCallback((timelineState: TimelineState) => {
    logger.info('时间轴状态变化', {
      totalDuration: timelineState.totalDuration,
      isPlaying: timelineState.isPlaying,
      currentTime: timelineState.currentTime,
      tracksCount: timelineState.tracks.length
    });

    const videoSequences = getVideoSequencesFromTimeline(timelineState);
    const totalDuration = videoSequences.reduce((total, seq) => total + seq.duration, 0);

    setCompositionPlayback(prev => ({
      ...prev,
      videoSequences,
      totalCompositionDuration: totalDuration,
      isCompositionMode: videoSequences.length > 0,
      // 重置序列索引如果视频序列发生变化
      currentSequenceIndex: videoSequences.length > 0 ? 0 : prev.currentSequenceIndex
    }));
  }, [getVideoSequencesFromTimeline, logger]);

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
  const handleCompositionSeek = useCallback((time: number) => {
    const clampedTime = Math.max(0, Math.min(time, compositionPlayback.totalCompositionDuration));
    
    // 计算当前应该播放的序列索引
    let currentSequenceIndex = 0;
    let accumulatedTime = 0;
    
    for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
      const sequence = compositionPlayback.videoSequences[i];
      if (accumulatedTime + sequence.duration > clampedTime) {
        currentSequenceIndex = i;
        break;
      }
      accumulatedTime += sequence.duration;
      currentSequenceIndex = i + 1;
    }

    logger.userAction('组合播放时间跳转', 'compositionSeek', {
      previousTime: compositionPlayback.compositionCurrentTime,
      newTime: clampedTime,
      previousSequenceIndex: compositionPlayback.currentSequenceIndex,
      newSequenceIndex: currentSequenceIndex,
      totalDuration: compositionPlayback.totalCompositionDuration
    });

    setCompositionPlayback(prev => ({
      ...prev,
      compositionCurrentTime: clampedTime,
      currentSequenceIndex
    }));
  }, [compositionPlayback, logger]);

  // 新增：切换到下一个视频序列
  const handleNextSequence = useCallback(() => {
    if (compositionPlayback.currentSequenceIndex < compositionPlayback.videoSequences.length - 1) {
      const nextIndex = compositionPlayback.currentSequenceIndex + 1;
      
      logger.info('切换到下一个视频序列', {
        currentIndex: compositionPlayback.currentSequenceIndex,
        nextIndex,
        currentSequence: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
        nextSequence: compositionPlayback.videoSequences[nextIndex]?.name
      });

      setCompositionPlayback(prev => ({
        ...prev,
        currentSequenceIndex: nextIndex
      }));

      return true; // 表示成功切换到下一个
    }
    
    logger.info('已到达最后一个视频序列', {
      currentIndex: compositionPlayback.currentSequenceIndex,
      totalSequences: compositionPlayback.videoSequences.length
    });
    
    return false; // 表示没有下一个视频
  }, [compositionPlayback, logger]);

  // 新增：更新组合播放时间
  const handleCompositionTimeUpdate = useCallback((currentTime: number) => {
    setCompositionPlayback(prev => ({
      ...prev,
      compositionCurrentTime: currentTime
    }));
  }, []);

  return {
    compositionPlayback,
    handleTimelineStateChange,
    handleCompositionPlay,
    handleCompositionPause,
    handleCompositionSeek,
    getVideoSequencesFromTimeline,
    // 新增的方法
    handleNextSequence,
    handleCompositionTimeUpdate
  };
}; 