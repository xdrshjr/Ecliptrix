import { useState, useCallback, useMemo, useEffect } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { UseTimelineCompositionReturn, VideoSequenceItem, AudioSequenceItem, CompositionPlayback } from '../types';
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
    audioSequences: [], // 新增：音频序列数据
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

  // 从时间轴状态提取视频序列
  const getVideoSequencesFromTimeline = useCallback((timelineState: TimelineState): VideoSequenceItem[] => {

    // 收集所有视频轨道的视频项目
    const allVideoItems: VideoSequenceItem[] = [];
    
    timelineState.tracks.forEach(track => {
      if (track.type === 'video' && track.isVisible && !track.isLocked) {
        track.items.forEach(item => {
          if (item.type === 'video' && item.materialId) {
            // 找到对应的素材
            const material = materials.find(m => m.id === item.materialId);
            if (material && material.type === 'video') {
              // 提取裁剪信息
              const clipStart = item.clipStart ?? 0;
              const clipEnd = item.clipEnd ?? item.originalDuration ?? item.duration;
              const originalDuration = item.originalDuration ?? item.duration;
              
              const videoSequence: VideoSequenceItem = {
                id: item.id,
                name: item.name,
                // 优先使用serverUrl（Supabase URL），如果没有则使用本地url
                // 这样确保视频合成时能够正确下载文件
                url: material.serverUrl || material.url,
                startTime: item.startTime,
                duration: item.duration,
                thumbnailUrl: item.thumbnailUrl || material.thumbnailUrl,
                materialId: item.materialId,
                trackId: item.trackId,
                // 新增：传递裁剪信息
                clipStart,
                clipEnd,
                originalDuration,
                // 新增：音量控制，结合轨道音量和项目音量
                volume: Math.max(0, Math.min((item.volume ?? 1) * (track.volume / 100), 1)) // 限制在[0,1]范围
              };
              allVideoItems.push(videoSequence);
              
              // 记录裁剪信息（仅在调试时启用）
              if (process.env.NODE_ENV === 'development') {
                logger.info('添加视频序列项目（包含裁剪信息和音量）', {
                  itemId: item.id,
                  itemName: item.name,
                  timelineStartTime: item.startTime,
                  timelineDuration: item.duration,
                  clipStart: clipStart.toFixed(2),
                  clipEnd: clipEnd.toFixed(2),
                  originalDuration: originalDuration.toFixed(2),
                  isTrimmed: clipStart > 0 || clipEnd < originalDuration,
                  trimmedDuration: (clipEnd - clipStart).toFixed(2),
                  materialUrl: material.url,
                  trackId: item.trackId,
                  // 新增：音量信息
                  itemVolume: item.volume ?? 1,
                  trackVolume: track.volume,
                  finalVolume: Math.max(0, Math.min((item.volume ?? 1) * (track.volume / 100), 1))
                });
              }
            }
          }
        });
      }
    });

    // 按开始时间排序
    const sortedVideoItems = allVideoItems.sort((a, b) => a.startTime - b.startTime);
    
    // 统计裁剪信息
    const trimmedCount = sortedVideoItems.filter(seq => 
      (seq.clipStart && seq.clipStart > 0) || 
      (seq.clipEnd && seq.originalDuration && seq.clipEnd < seq.originalDuration)
    ).length;
    
    // 仅在调试模式或有实际变化时记录日志
    if (process.env.NODE_ENV === 'development' && sortedVideoItems.length > 0) {
      logger.info('视频序列提取完成（包含裁剪统计）', {
        totalVideoSequences: sortedVideoItems.length,
        trimmedSequences: trimmedCount,
        untrimmedSequences: sortedVideoItems.length - trimmedCount,
        sequences: sortedVideoItems.map(seq => ({
          id: seq.id,
          name: seq.name,
          timelineStartTime: seq.startTime,
          timelineDuration: seq.duration,
          clipStart: seq.clipStart?.toFixed(2) || '0.00',
          clipEnd: seq.clipEnd?.toFixed(2) || 'N/A',
          originalDuration: seq.originalDuration?.toFixed(2) || 'N/A',
          isTrimmed: (seq.clipStart && seq.clipStart > 0) || 
                    (seq.clipEnd && seq.originalDuration && seq.clipEnd < seq.originalDuration)
        }))
      });
    }

    return sortedVideoItems;
  }, [materials, logger]);

  // 新增：从时间轴状态提取音频序列
  const getAudioSequencesFromTimeline = useCallback((timelineState: TimelineState): AudioSequenceItem[] => {
    // 收集所有音频轨道的音频项目
    const allAudioItems: AudioSequenceItem[] = [];
    
    timelineState.tracks.forEach(track => {
      if (track.type === 'audio' && track.isVisible && !track.isLocked && !track.isMuted) {
        track.items.forEach(item => {
          if (item.type === 'audio' && item.materialId) {
            // 找到对应的素材
            const material = materials.find(m => m.id === item.materialId);
            if (material && material.type === 'audio') {
              // 提取裁剪信息
              const clipStart = item.clipStart ?? 0;
              const clipEnd = item.clipEnd ?? item.originalDuration ?? item.duration;
              const originalDuration = item.originalDuration ?? item.duration;
              
              const audioSequence: AudioSequenceItem = {
                id: item.id,
                name: item.name,
                // 优先使用serverUrl，如果没有则使用本地url
                url: material.serverUrl || material.url,
                startTime: item.startTime,
                duration: item.duration,
                materialId: item.materialId,
                trackId: item.trackId,
                volume: Math.max(0, Math.min((item.volume ?? 1) * (track.volume / 100), 1)), // 结合轨道音量和项目音量，限制在[0,1]范围
                // 传递裁剪信息
                clipStart,
                clipEnd,
                originalDuration
              };
              allAudioItems.push(audioSequence);
              
              // 记录音频序列信息（仅在调试时启用）
              if (process.env.NODE_ENV === 'development') {
                logger.info('添加音频序列项目（包含裁剪信息）', {
                  itemId: item.id,
                  itemName: item.name,
                  timelineStartTime: item.startTime,
                  timelineDuration: item.duration,
                  clipStart: clipStart.toFixed(2),
                  clipEnd: clipEnd.toFixed(2),
                  originalDuration: originalDuration.toFixed(2),
                  isTrimmed: clipStart > 0 || clipEnd < originalDuration,
                  trimmedDuration: (clipEnd - clipStart).toFixed(2),
                  volume: audioSequence.volume?.toFixed(2) || '1.00',
                  trackVolume: track.volume,
                  itemVolume: item.volume ?? 1,
                  materialUrl: material.url,
                  trackId: item.trackId
                });
              }
            }
          }
        });
      }
    });

    // 按开始时间排序
    const sortedAudioItems = allAudioItems.sort((a, b) => a.startTime - b.startTime);
    
    // 仅在调试模式或有实际变化时记录日志
    if (process.env.NODE_ENV === 'development' && sortedAudioItems.length > 0) {
      logger.info('音频序列提取完成', {
        totalAudioSequences: sortedAudioItems.length,
        sequences: sortedAudioItems.map(seq => ({
          id: seq.id,
          name: seq.name,
          timelineStartTime: seq.startTime,
          timelineDuration: seq.duration,
          volume: seq.volume?.toFixed(2) || '1.00',
          clipStart: seq.clipStart?.toFixed(2) || '0.00',
          clipEnd: seq.clipEnd?.toFixed(2) || 'N/A'
        }))
      });
    }

    return sortedAudioItems;
  }, [materials, logger]);

  // 处理时间轴状态变化
  const handleTimelineStateChange = useCallback((timelineState: TimelineState) => {
    const videoSequences = getVideoSequencesFromTimeline(timelineState);
    const audioSequences = getAudioSequencesFromTimeline(timelineState); // 新增：提取音频序列
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

      logger.info('时间轴状态变化 - 更新组合播放状态（包含音频序列）', {
        totalDuration: timelineState.totalDuration,
        isPlaying: timelineState.isPlaying,
        currentTime: timelineState.currentTime,
        tracksCount: timelineState.tracks.length,
        videoSequencesCount: videoSequences.length,
        audioSequencesCount: audioSequences.length, // 新增：音频序列数量
        sequencesChanged: videoSequencesChanged || audioSequencesChanged,
        previousVideoSequencesCount: prev.videoSequences.length,
        previousAudioSequencesCount: prev.audioSequences.length,
        isCompositionMode: videoSequences.length > 0,
        firstVideoSequence: videoSequences.length > 0 ? {
          id: videoSequences[0].id,
          name: videoSequences[0].name,
          url: videoSequences[0].url,
          startTime: videoSequences[0].startTime?.toFixed(2),
          duration: videoSequences[0].duration?.toFixed(2),
          clipStart: videoSequences[0].clipStart?.toFixed(2) || '0.00',
          clipEnd: videoSequences[0].clipEnd?.toFixed(2) || 'N/A'
        } : null,
                 audioSequencesSummary: audioSequences.length > 0 ? {
           count: audioSequences.length,
           totalDuration: audioSequences.reduce((sum, seq) => sum + seq.duration, 0).toFixed(2),
           trackIds: Array.from(new Set(audioSequences.map(seq => seq.trackId)))
         } : null,
        message: `组合播放模式${videoSequences.length > 0 ? '已激活' : '已关闭'}，${audioSequences.length > 0 ? `包含${audioSequences.length}个音频序列` : '无音频序列'}`
      });

      return {
        ...prev,
        videoSequences,
        audioSequences, // 新增：更新音频序列
        totalCompositionDuration: totalDuration,
        isCompositionMode: videoSequences.length > 0,
        // 重置序列索引如果视频序列发生变化
        currentSequenceIndex: videoSequences.length > 0 ? 0 : prev.currentSequenceIndex
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

  // 新增：更新当前序列索引
  const handleSequenceIndexUpdate = useCallback((sequenceIndex: number) => {
    logger.info('更新当前播放序列索引', {
      previousIndex: compositionPlayback.currentSequenceIndex,
      newIndex: sequenceIndex,
      sequenceName: compositionPlayback.videoSequences[sequenceIndex]?.name
    });
    
    setCompositionPlayback(prev => ({
      ...prev,
      currentSequenceIndex: sequenceIndex
    }));
  }, [compositionPlayback.currentSequenceIndex, compositionPlayback.videoSequences, logger]);

  return {
    compositionPlayback,
    handleTimelineStateChange,
    handleCompositionPlay,
    handleCompositionPause,
    handleCompositionSeek,
    getVideoSequencesFromTimeline,
    getAudioSequencesFromTimeline, // 新增：返回音频序列提取方法
    // 新增的方法
    handleNextSequence,
    handleCompositionTimeUpdate,
    handleSequenceIndexUpdate
  };
}; 