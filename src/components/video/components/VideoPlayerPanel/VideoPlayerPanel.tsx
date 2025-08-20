'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { UseVideoPlaybackReturn, VideoPreview, CompositionPlayback, VideoSequenceItem } from '../../types';
import { TimelineState, MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useVideoExport } from '../../hooks/useVideoExport';
import VideoExportProgressModal from './VideoExportProgressModal';

// 视频比例类型定义
interface AspectRatio {
  id: string;
  label: string;
  ratio: string;
  description: string;
  cssClass: string;
}

// 预定义的视频比例
const ASPECT_RATIOS: AspectRatio[] = [
  {
    id: '16:9',
    label: '16:9',
    ratio: '16/9',
    description: '横屏视频 (标准)',
    cssClass: 'aspect-video'
  },
  {
    id: '9:16',
    label: '9:16',
    ratio: '9/16',
    description: '竖屏视频 (手机)',
    cssClass: 'aspect-[9/16]'
  },
  {
    id: '4:3',
    label: '4:3',
    ratio: '4/3',
    description: '传统屏幕',
    cssClass: 'aspect-[4/3]'
  },
  {
    id: '1:1',
    label: '1:1',
    ratio: '1/1',
    description: '正方形',
    cssClass: 'aspect-square'
  },
  {
    id: '21:9',
    label: '21:9',
    ratio: '21/9',
    description: '超宽屏',
    cssClass: 'aspect-[21/9]'
  }
];

interface VideoPlayerPanelProps extends UseVideoPlaybackReturn {
  videoPreview: VideoPreview;
  taskId: string;
  className?: string;
  // Add composition support
  compositionPlayback?: CompositionPlayback;
  onCompositionPlayPause?: () => void;
  onCompositionSeek?: (time: number) => void;
  // 新增：处理下一个序列
  onNextSequence?: () => boolean;
  onCompositionTimeUpdate?: (currentTime: number) => void;
  // 新增：同步时间到timeline
  onTimelineTimeUpdate?: (currentTime: number) => void;
  // 新增：当前timeline时间，用于从游标位置开始播放
  currentTimelineTime?: number;
  // 新增：更新序列索引
  onSequenceIndexUpdate?: (sequenceIndex: number) => void;
  // 新增：导出功能相关props
  timelineState?: TimelineState;
  materials?: MaterialItem[];
}

const VideoPlayerPanel: React.FC<VideoPlayerPanelProps> = ({
  isPlaying,
  currentTime,
  volume,
  playbackRate,
  handlePlayPause,
  handleTimeSeek,
  handleVolumeChange,
  handlePlaybackRateChange,
  handleFullscreenToggle,
  formatTime,
  videoPreview,
  taskId,
  className = '',
  compositionPlayback,
  onCompositionPlayPause,
  onCompositionSeek,
  onNextSequence,
  onCompositionTimeUpdate,
  onTimelineTimeUpdate,
  currentTimelineTime,
  onSequenceIndexUpdate,
  timelineState,
  materials
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoPlayerPanel'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCompositionPlaying, setIsCompositionPlaying] = useState(false);
  const [compositionCurrentTime, setCompositionCurrentTime] = useState(0);
  
  // 新增：视频比例状态
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(ASPECT_RATIOS[0]);

  // 使用导出hook（仅在有timelineState时启用）
  const videoExport = useVideoExport({
    timelineState: timelineState || {
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1,
      selectedItems: [],
      tracks: [],
      playbackRate: 1,
      isPlaying: false,
      snapToGrid: false,
      gridSize: 1
    },
    materials: materials || [],
    taskId,
    aspectRatio: selectedAspectRatio.id // Pass selected aspect ratio to export hook
  });

  // 当前播放模式：preview 或 composition
  const playbackMode = compositionPlayback?.isCompositionMode && compositionPlayback.videoSequences.length > 0 
    ? 'composition' : 'preview';

  // 处理视频比例切换
  const handleAspectRatioChange = useCallback((aspectRatio: AspectRatio) => {
    console.log(`[VideoPlayerPanel] 比例切换调试`, {
      fromRatio: selectedAspectRatio.id,
      toRatio: aspectRatio.id,
      fromObject: selectedAspectRatio,
      toObject: aspectRatio,
      timestamp: new Date().toISOString()
    });
    
    logger.info('切换视频比例', {
      fromRatio: selectedAspectRatio.id,
      toRatio: aspectRatio.id,
      ratioDescription: aspectRatio.description,
      playbackMode,
      uiLocation: '信息面板第二行的比例选择器'
    });
    
    setSelectedAspectRatio(aspectRatio);
    
    // 记录比例切换的详细信息
    logger.info('视频比例切换完成', {
      newRatio: aspectRatio.id,
      newRatioValue: aspectRatio.ratio,
      newCssClass: aspectRatio.cssClass,
      layoutStructure: '视频预览容器占用大部分高度，比例选择器在信息面板第二行',
      uiDesign: '两行布局：第一行显示视频信息，第二行显示比例选择器',
      timestamp: new Date().toISOString()
    });
  }, [selectedAspectRatio, playbackMode, logger]);

  // 处理视频导出（带比例信息记录）
  const handleVideoExport = useCallback(async () => {
    console.log(`[VideoPlayerPanel] 导出前最终检查`, {
      selectedAspectRatioId: selectedAspectRatio.id,
      selectedAspectRatioObject: selectedAspectRatio,
      timestamp: new Date().toISOString()
    });
    
    logger.info('用户点击导出视频按钮', {
      selectedAspectRatio: selectedAspectRatio.id,
      aspectRatioDescription: selectedAspectRatio.description,
      aspectRatioValue: selectedAspectRatio.ratio,
      playbackMode,
      hasTimelineState: !!timelineState,
      tracksCount: timelineState?.tracks.length || 0,
      materialsCount: materials?.length || 0,
      totalDuration: timelineState?.totalDuration || 0,
      exportButtonLocation: '视频合成播放面板头部右侧',
      timestamp: new Date().toISOString()
    });

    // 调用实际的导出函数
    await videoExport.handleExport();
  }, [selectedAspectRatio, playbackMode, timelineState, materials, videoExport.handleExport, logger]);

  useEffect(() => {
    logger.info('组件初始化', {
      isPlaying,
      currentTime,
      volume,
      playbackRate,
      videoTitle: videoPreview.title,
      videoDuration: videoPreview.duration,
      playbackMode,
      compositionSequencesCount: compositionPlayback?.videoSequences.length || 0,
      initialAspectRatio: selectedAspectRatio.id,
      layoutStructure: '视频预览容器占用大部分高度，比例选择器在信息面板第二行',
      uiDesign: '两行布局：第一行显示视频信息，第二行显示比例选择器，整体高度紧凑',
      placeholderDesign: '占位符充满整个预览容器，无图标设计，仅显示文本和比例信息'
    });
  }, []);

  // 组合播放时的视频切换逻辑
  const handleVideoEnded = useCallback(() => {
    if (playbackMode === 'composition' && compositionPlayback && onNextSequence) {
      const currentIndex = compositionPlayback.currentSequenceIndex;
      const nextIndex = currentIndex + 1;
      const currentSequence = compositionPlayback.videoSequences[currentIndex];
      
      logger.info('视频播放结束，尝试切换到下一个', {
        currentIndex,
        nextIndex,
        totalSequences: compositionPlayback.videoSequences.length,
        currentSequence: currentSequence?.name,
        currentSequenceClipEnd: currentSequence?.clipEnd?.toFixed(2) || 'N/A'
      });

      // 检查是否有下一个视频
      if (nextIndex < compositionPlayback.videoSequences.length) {
        const nextSequence = compositionPlayback.videoSequences[nextIndex];
        
        // 先切换状态
        const hasNext = onNextSequence();
        
        if (hasNext && nextSequence && videoRef.current) {
          // 计算下一个视频的裁剪起始位置
          const nextClipStart = nextSequence.clipStart || 0;
          
          logger.info('加载下一个视频（考虑裁剪）', {
            nextIndex,
            sequenceName: nextSequence.name,
            sequenceUrl: nextSequence.url,
            clipStart: nextClipStart.toFixed(2),
            clipEnd: nextSequence.clipEnd?.toFixed(2) || 'N/A'
          });
          
          // 直接使用nextSequence，因为我们知道它是下一个
          videoRef.current.src = nextSequence.url;
          videoRef.current.currentTime = nextClipStart; // 从裁剪起始位置开始
          videoRef.current.play().catch(error => {
            logger.error('自动播放下一个视频失败（裁剪模式）', error, {
              nextIndex,
              sequenceName: nextSequence.name,
              clipStart: nextClipStart.toFixed(2)
            });
          });
        }
      } else {
        // 所有视频播放完毕
        logger.info('组合播放完毕', {
          totalSequencesPlayed: compositionPlayback.videoSequences.length,
          totalDuration: compositionPlayback.totalCompositionDuration
        });
        setIsCompositionPlaying(false);
        if (onCompositionPlayPause) {
          onCompositionPlayPause();
        }
      }
    }
  }, [playbackMode, compositionPlayback, onNextSequence, onCompositionPlayPause, logger]);

  // 更新组合播放时间
  const handleTimeUpdate = useCallback(() => {
    if (playbackMode === 'composition' && compositionPlayback && videoRef.current) {
      const videoCurrentTime = videoRef.current.currentTime;
      const currentVideoSrc = videoRef.current.src;
      
      // 根据当前播放的视频URL找到正确的序列索引，避免状态更新延迟问题
      let actualSequenceIndex = 0;
      let foundSequence = false;
      let currentSequence = null;
      
      for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
        const sequence = compositionPlayback.videoSequences[i];
        if (currentVideoSrc.includes(sequence.url) || sequence.url.includes(currentVideoSrc.split('/').pop() || '')) {
          actualSequenceIndex = i;
          currentSequence = sequence;
          foundSequence = true;
          break;
        }
      }
      
      // 如果没有找到匹配的序列，使用状态中的索引作为后备
      if (!foundSequence) {
        actualSequenceIndex = compositionPlayback.currentSequenceIndex;
        currentSequence = compositionPlayback.videoSequences[actualSequenceIndex];
        logger.warn('未找到匹配的视频序列，使用状态中的索引', {
          currentVideoSrc,
          fallbackIndex: actualSequenceIndex
        });
      }
      
      // 检查是否超出裁剪范围，如果是则自动切换到下一个视频
      if (currentSequence) {
        const clipEnd = currentSequence.clipEnd || currentSequence.originalDuration || currentSequence.duration;
        if (videoCurrentTime >= clipEnd) {
          logger.info('当前视频播放超出裁剪范围，触发切换', {
            videoCurrentTime: videoCurrentTime.toFixed(2),
            clipEnd: clipEnd.toFixed(2),
            sequenceName: currentSequence.name
          });
          handleVideoEnded();
          return;
        }
      }
      
      // 计算timeline上的相对时间（考虑裁剪）
      let timelineRelativeTime = videoCurrentTime;
      if (currentSequence) {
        const clipStart = currentSequence.clipStart || 0;
        const clipEnd = currentSequence.clipEnd || currentSequence.originalDuration || currentSequence.duration;
        const clipDuration = clipEnd - clipStart;
        
        // 将视频实际时间映射回timeline时间
        timelineRelativeTime = (videoCurrentTime - clipStart) * currentSequence.duration / clipDuration;
        timelineRelativeTime = Math.max(0, Math.min(timelineRelativeTime, currentSequence.duration));
      }
      
      // 计算组合播放的总时间，使用实际的序列索引
      let accumulatedTime = 0;
      for (let i = 0; i < actualSequenceIndex; i++) {
        accumulatedTime += compositionPlayback.videoSequences[i].duration;
      }
      accumulatedTime += timelineRelativeTime;
      
      setCompositionCurrentTime(accumulatedTime);
      
      logger.info('组合播放时间更新（裁剪模式）', {
        videoCurrentTime: videoCurrentTime.toFixed(2),
        timelineRelativeTime: timelineRelativeTime.toFixed(2),
        stateSequenceIndex: compositionPlayback.currentSequenceIndex,
        actualSequenceIndex: actualSequenceIndex,
        accumulatedTime: accumulatedTime.toFixed(2),
        totalSequences: compositionPlayback.videoSequences.length,
        foundSequence,
        clipStart: currentSequence?.clipStart?.toFixed(2) || '0.00',
        clipEnd: currentSequence?.clipEnd?.toFixed(2) || 'N/A'
      });
      
      // 通知父组件时间更新
      if (onCompositionTimeUpdate) {
        onCompositionTimeUpdate(accumulatedTime);
      }

      // 同步时间到timeline（关键修改）
      if (onTimelineTimeUpdate) {
        logger.info('同步时间到timeline（裁剪模式）', {
          currentTime: accumulatedTime.toFixed(2),
          playbackMode: 'composition',
          actualSequenceIndex,
          timelineRelativeTime: timelineRelativeTime.toFixed(2)
        });
        onTimelineTimeUpdate(accumulatedTime);
      }
    } else if (playbackMode === 'preview' && videoRef.current) {
      // 预览模式下也需要同步时间到timeline
      const videoCurrentTime = videoRef.current.currentTime;
      
      logger.info('预览播放时间更新', {
        videoCurrentTime: videoCurrentTime.toFixed(2),
        playbackMode: 'preview'
      });

      if (onTimelineTimeUpdate) {
        logger.info('同步时间到timeline', {
          currentTime: videoCurrentTime.toFixed(2),
          playbackMode: 'preview'
        });
        onTimelineTimeUpdate(videoCurrentTime);
      }
    }
  }, [playbackMode, compositionPlayback, onCompositionTimeUpdate, onTimelineTimeUpdate, handleVideoEnded, logger]);

  // 处理播放/暂停点击
  const handlePlayPauseClick = useCallback(() => {
    if (playbackMode === 'composition') {
      logger.userAction('组合播放/暂停切换', 'compositionPlayPauseButton', {
        currentState: isCompositionPlaying ? '播放中' : '已暂停',
        newState: isCompositionPlaying ? '暂停' : '播放',
        currentSequenceIndex: compositionPlayback?.currentSequenceIndex,
        currentTime: compositionCurrentTime,
        totalSequences: compositionPlayback?.videoSequences.length
      });

      if (videoRef.current) {
        if (isCompositionPlaying) {
          videoRef.current.pause();
        } else {
          // 开始组合播放
          if (compositionPlayback && compositionPlayback.videoSequences.length > 0) {
            // 使用timeline当前时间确定播放起始位置
            const startTime = currentTimelineTime || 0;
            
            // 计算应该播放哪个视频序列和序列内的时间
            let targetSequenceIndex = 0;
            let accumulatedTime = 0;
            let targetVideoTime = startTime;

            for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
              const sequence = compositionPlayback.videoSequences[i];
              if (accumulatedTime + sequence.duration > startTime) {
                targetSequenceIndex = i;
                targetVideoTime = startTime - accumulatedTime;
                break;
              }
              accumulatedTime += sequence.duration;
            }

            const targetSequence = compositionPlayback.videoSequences[targetSequenceIndex];
            if (targetSequence) {
              // 计算在原始视频文件中的实际播放时间，考虑裁剪
              const clipStart = targetSequence.clipStart || 0;
              const clipEnd = targetSequence.clipEnd || targetSequence.originalDuration || targetSequence.duration;
              const clipDuration = clipEnd - clipStart;
              
              // 将timeline时间映射到裁剪后的视频时间
              const actualVideoTime = clipStart + (targetVideoTime * clipDuration / targetSequence.duration);
              
              logger.info('开始组合播放，从timeline当前位置开始（考虑裁剪）', {
                timelineCurrentTime: startTime.toFixed(2),
                targetSequenceIndex,
                targetSequenceName: targetSequence.name,
                targetSequenceUrl: targetSequence.url,
                targetVideoTime: targetVideoTime.toFixed(2),
                clipStart: clipStart.toFixed(2),
                clipEnd: clipEnd.toFixed(2),
                clipDuration: clipDuration.toFixed(2),
                actualVideoTime: actualVideoTime.toFixed(2),
                isTrimmed: clipStart > 0 || clipEnd < (targetSequence.originalDuration || targetSequence.duration),
                accumulatedTime: accumulatedTime.toFixed(2)
              });
              
              videoRef.current.src = targetSequence.url;
              videoRef.current.currentTime = Math.max(clipStart, Math.min(actualVideoTime, clipEnd)); // 确保在裁剪范围内
              setCompositionCurrentTime(startTime);
              
              // 更新当前序列索引
              if (compositionPlayback.currentSequenceIndex !== targetSequenceIndex) {
                logger.info('播放开始时切换视频序列（裁剪模式）', {
                  previousSequenceIndex: compositionPlayback.currentSequenceIndex,
                  newSequenceIndex: targetSequenceIndex,
                  clipStart: clipStart.toFixed(2),
                  clipEnd: clipEnd.toFixed(2)
                });
                
                if (onSequenceIndexUpdate) {
                  onSequenceIndexUpdate(targetSequenceIndex);
                }
              }
              
              videoRef.current.play().catch(error => {
                logger.error('开始播放组合视频失败（裁剪模式）', error, {
                  sequenceIndex: targetSequenceIndex,
                  sequenceName: targetSequence.name,
                  startTime: targetVideoTime.toFixed(2),
                  actualVideoTime: actualVideoTime.toFixed(2),
                  clipStart: clipStart.toFixed(2),
                  clipEnd: clipEnd.toFixed(2)
                });
              });
            }
          }
        }
        setIsCompositionPlaying(!isCompositionPlaying);
      }
      
      if (onCompositionPlayPause) {
        onCompositionPlayPause();
      }
    } else {
      // 原有的预览模式播放逻辑
      logger.userAction('预览播放/暂停切换', 'previewPlayPauseButton', {
        currentState: isPlaying ? '播放中' : '已暂停',
        newState: isPlaying ? '暂停' : '播放',
        currentTime,
        duration: videoPreview.duration
      });
      
      handlePlayPause();
    }
  }, [playbackMode, isCompositionPlaying, compositionPlayback, compositionCurrentTime, isPlaying, currentTime, videoPreview.duration, onCompositionPlayPause, handlePlayPause, logger]);

  // 处理时间跳转
  const handleTimeSeekClick = useCallback((newTime: number) => {
    if (playbackMode === 'composition' && compositionPlayback) {
      logger.userAction('组合播放时间跳转', 'compositionTimeSeek', {
        previousTime: compositionCurrentTime,
        newTime,
        totalDuration: compositionPlayback.totalCompositionDuration
      });

      // 计算应该跳转到哪个视频序列
      let targetSequenceIndex = 0;
      let accumulatedTime = 0;
      let targetVideoTime = newTime;

      for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
        const sequence = compositionPlayback.videoSequences[i];
        if (accumulatedTime + sequence.duration > newTime) {
          targetSequenceIndex = i;
          targetVideoTime = newTime - accumulatedTime;
          break;
        }
        accumulatedTime += sequence.duration;
      }

      const targetSequence = compositionPlayback.videoSequences[targetSequenceIndex];
      if (targetSequence && videoRef.current) {
        videoRef.current.src = targetSequence.url;
        videoRef.current.currentTime = targetVideoTime;
        setCompositionCurrentTime(newTime);
      }

      if (onCompositionSeek) {
        onCompositionSeek(newTime);
      }
    } else {
      // 原有的预览模式时间跳转
      handleTimeSeek(newTime);
    }
  }, [playbackMode, compositionPlayback, compositionCurrentTime, onCompositionSeek, handleTimeSeek, logger]);

  // 获取当前显示的时长和当前时间
  const getCurrentTime = () => {
    return playbackMode === 'composition' ? compositionCurrentTime : currentTime;
  };

  const getTotalDuration = () => {
    return playbackMode === 'composition' 
      ? (compositionPlayback?.totalCompositionDuration || 0)
      : videoPreview.duration;
  };

  const getCurrentlyPlaying = () => {
    return playbackMode === 'composition' ? isCompositionPlaying : isPlaying;
  };

  // 获取当前显示的视频信息
  const getCurrentVideoInfo = () => {
    if (playbackMode === 'composition' && compositionPlayback && compositionPlayback.videoSequences.length > 0) {
      const currentSequence = compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex];
      return {
        title: `组合播放 (${compositionPlayback.currentSequenceIndex + 1}/${compositionPlayback.videoSequences.length}): ${currentSequence?.name || '未知'}`,
        resolution: videoPreview.resolution, // 使用默认分辨率
        frameRate: videoPreview.frameRate,
        format: videoPreview.format
      };
    }
    return {
      title: videoPreview.title,
      resolution: videoPreview.resolution,
      frameRate: videoPreview.frameRate,
      format: videoPreview.format
    };
  };

  const currentVideoInfo = getCurrentVideoInfo();

  return (
    <div 
      className={`video-editing-composition-panel ${className}`}
      tabIndex={0}
      aria-label="视频合成播放面板"
    >
      <div className="composition-panel-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-1a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">
              {playbackMode === 'composition' ? '视频合成播放' : '视频预览播放'}
            </h3>
            {playbackMode === 'composition' && (
              <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
                {compositionPlayback?.videoSequences.length || 0} 个视频
              </span>
            )}
          </div>
          
          {/* 导出视频按钮 */}
          {timelineState && timelineState.tracks.length > 0 && (
            <button
              onClick={handleVideoExport}
              disabled={videoExport.isExporting}
              className={`
                flex items-center space-x-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200
                ${videoExport.isExporting 
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 hover:shadow-md'
                }
              `}
              tabIndex={0}
              aria-label={videoExport.isExporting ? `正在导出视频 (${selectedAspectRatio.id})...` : `导出视频 (${selectedAspectRatio.id})`}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !videoExport.isExporting) {
                  e.preventDefault();
                  handleVideoExport();
                }
              }}
            >
              {videoExport.isExporting ? (
                <>
                  <div className="relative w-3 h-3">
                    <svg className="w-3 h-3 animate-spin" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    {videoExport.exportProgress > 0 && (
                      <div className="absolute -top-0.5 -right-0.5 text-[8px] bg-blue-500 text-white rounded-full w-2 h-2 flex items-center justify-center">
                        {Math.round(videoExport.exportProgress)}
                      </div>
                    )}
                  </div>
                  <span>
                    {videoExport.exportProgress > 0 
                      ? `导出中 ${Math.round(videoExport.exportProgress)}%` 
                      : '导出中...'
                    }
                  </span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
                  </svg>
                  <span>导出视频</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
      
      <div className="composition-panel-content">
        <div className="video-player-container">
          {/* 视频播放器区域 - 固定占用70%高度 */}
          <div className="video-player-wrapper flex-1 flex flex-col">
            {/* 视频预览容器 - 固定高度70% */}
            <div className="video-preview-container flex-1 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden">
              {playbackMode === 'composition' && compositionPlayback && compositionPlayback.videoSequences.length > 0 ? (
                // 组合播放模式
                <div className={`${selectedAspectRatio.cssClass} bg-black rounded-xl overflow-hidden shadow-lg`} style={{ maxHeight: '100%', maxWidth: '100%' }}>
                  <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    onEnded={handleVideoEnded}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadStart={() => {
                      logger.info('组合视频开始加载', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        aspectRatio: selectedAspectRatio.id,
                        containerHeight: '70% of upper panel'
                      });
                    }}
                    onCanPlay={() => {
                      logger.info('组合视频可播放', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        aspectRatio: selectedAspectRatio.id,
                        containerHeight: '70% of upper panel'
                      });
                    }}
                    onLoadedData={() => {
                      logger.info('组合视频数据加载完成', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        duration: videoRef.current?.duration,
                        aspectRatio: selectedAspectRatio.id,
                        containerHeight: '70% of upper panel'
                      });
                    }}
                    onError={(e) => {
                      logger.error('组合视频加载失败', new Error('Video load error'), {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        error: e.currentTarget.error?.message,
                        aspectRatio: selectedAspectRatio.id,
                        containerHeight: '70% of upper panel'
                      });
                    }}
                  />
                </div>
              ) : (
                // 预览模式占位符 - 充满整个容器
                <div className="video-placeholder-container">
                  {/* 比例预览框 */}
                  <div className={`${selectedAspectRatio.cssClass} video-placeholder-frame`}>
                    <div className="placeholder-content">
                      <p className="placeholder-text">
                        {playbackMode === 'composition' 
                          ? '时间轴中没有视频素材\n请在时间轴中添加视频素材后播放'
                          : '点击播放按钮预览视频'}
                      </p>
                      <div className="placeholder-aspect-info">
                        当前比例: {selectedAspectRatio.label} ({selectedAspectRatio.description})
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>


          </div>

          {/* 播放控制栏 */}
          <div className="video-controls">
            <div className="controls-row">
              <div className="left-controls">
                <button
                  onClick={handlePlayPauseClick}
                  className="control-btn play-pause-btn"
                  title={getCurrentlyPlaying() ? "暂停" : "播放"}
                >
                  {getCurrentlyPlaying() ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                <div className="time-display">
                  <span className="current-time">{formatTime(getCurrentTime())}</span>
                  <span className="time-separator">/</span>
                  <span className="total-time">{formatTime(getTotalDuration())}</span>
                </div>
              </div>

              <div className="center-controls">
                <div className="progress-container">
                  <input
                    type="range"
                    min="0"
                    max={getTotalDuration()}
                    value={getCurrentTime()}
                    onChange={(e) => handleTimeSeekClick(parseFloat(e.target.value))}
                    className="progress-slider"
                  />
                </div>
              </div>

              <div className="right-controls">
                <div className="volume-control">
                  <button
                    className="control-btn volume-btn"
                    title="音量"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M6.343 6.343A8 8 0 004.222 12a8 8 0 002.121 5.657l1.414-1.414A6 6 0 016.222 12a6 6 0 011.535-4.243l-1.414-1.414zM12 6l-2 2H7a1 1 0 00-1 1v6a1 1 0 001 1h3l2 2V6z" />
                    </svg>
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="volume-slider"
                  />
                </div>

                <select
                  value={playbackRate}
                  onChange={(e) => handlePlaybackRateChange(parseFloat(e.target.value))}
                  className="speed-select"
                  title="播放速度"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                </select>

                <button
                  onClick={handleFullscreenToggle}
                  className="control-btn fullscreen-btn"
                  title="全屏"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="video-info-panel">
            {/* 第一行：视频基本信息 */}
            <div className="video-info-row">
              <div className="video-info-group">
                <div className="info-item-inline">
                  <span className="info-label">标题</span>
                  <span className="info-value info-title">{currentVideoInfo.title}</span>
                </div>
                <div className="info-separator"></div>
                <div className="info-item-inline">
                  <span className="info-label">分辨率</span>
                  <span className="info-value">{currentVideoInfo.resolution.width}×{currentVideoInfo.resolution.height}</span>
                </div>
                <div className="info-separator"></div>
                <div className="info-item-inline">
                  <span className="info-label">帧率</span>
                  <span className="info-value">{currentVideoInfo.frameRate}fps</span>
                </div>
                <div className="info-separator"></div>
                <div className="info-item-inline">
                  <span className="info-label">格式</span>
                  <span className="info-value">{currentVideoInfo.format}</span>
                </div>
              </div>
            </div>
            
            {/* 第二行：视频比例选择器 */}
            <div className="aspect-ratio-row">
              <div className="aspect-ratio-group">
                <span className="info-label">比例</span>
                <div className="aspect-ratio-buttons">
                  {ASPECT_RATIOS.map((aspectRatio) => (
                    <button
                      key={aspectRatio.id}
                      onClick={() => handleAspectRatioChange(aspectRatio)}
                      className={`
                        aspect-ratio-btn
                        ${selectedAspectRatio.id === aspectRatio.id
                          ? 'aspect-ratio-btn-active'
                          : 'aspect-ratio-btn-inactive'
                        }
                      `}
                      title={aspectRatio.description}
                      tabIndex={0}
                      aria-label={`选择${aspectRatio.description}比例`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleAspectRatioChange(aspectRatio);
                        }
                      }}
                    >
                      {aspectRatio.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* 视频导出进度弹窗 */}
      <VideoExportProgressModal
        isOpen={videoExport.isExporting}
        progress={videoExport.exportProgress}
        allowCancel={false}
      />
    </div>
  );
};

export default VideoPlayerPanel; 