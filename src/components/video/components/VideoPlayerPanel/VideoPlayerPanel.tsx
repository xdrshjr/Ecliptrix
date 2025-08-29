'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { UseVideoPlaybackReturn, VideoPreview, CompositionPlayback, VideoSequenceItem } from '../../types';
import { TimelineState, MaterialItem, ImagePosition } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useVideoExport } from '../../hooks/useVideoExport';
import VideoExportProgressModal from './VideoExportProgressModal';
import ImageOverlay from './ImageOverlay';
import { useLocale } from '@/contexts/LocaleContext';

// 视频比例类型定义
interface AspectRatio {
  id: string;
  label: string;
  ratio: string;
  description: string;
  cssClass: string;
}



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
  // 新增：图片叠加位置更新回调
  onImagePositionChange?: (itemId: string, position: ImagePosition) => void;
}

const VideoPlayerPanel: React.FC<VideoPlayerPanelProps> = ({
  isPlaying,
  currentTime,
  volume,
  effectiveVolume, // 新增：实际应用到video元素的有效音量
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
  materials,
  onImagePositionChange
}) => {
  const { t } = useLocale();
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoPlayerPanel'
  });

  // 基于翻译的视频比例配置
  const ASPECT_RATIOS = useMemo((): AspectRatio[] => [
    {
      id: '16:9',
      label: '16:9',
      ratio: '16/9',
      description: t.videoPlayerPanel.aspectRatios.landscapeStandard,
      cssClass: 'aspect-video'
    },
    {
      id: '9:16',
      label: '9:16',
      ratio: '9/16',
      description: t.videoPlayerPanel.aspectRatios.portraitMobile,
      cssClass: 'aspect-[9/16]'
    },
    {
      id: '4:3',
      label: '4:3',
      ratio: '4/3',
      description: t.videoPlayerPanel.aspectRatios.traditionalScreen,
      cssClass: 'aspect-[4/3]'
    },
    {
      id: '1:1',
      label: '1:1',
      ratio: '1/1',
      description: t.videoPlayerPanel.aspectRatios.square,
      cssClass: 'aspect-square'
    },
    {
      id: '21:9',
      label: '21:9',
      ratio: '21/9',
      description: t.videoPlayerPanel.aspectRatios.ultrawide,
      cssClass: 'aspect-[21/9]'
    }
  ], [t]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCompositionPlaying, setIsCompositionPlaying] = useState(false);
  const [compositionCurrentTime, setCompositionCurrentTime] = useState(0);
  
  // 新增：视频比例状态
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatio>(ASPECT_RATIOS[0]);

  // 新增：图片叠加相关状态
  const [selectedImageOverlay, setSelectedImageOverlay] = useState<string | null>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // 新增：应用音量到video元素
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = effectiveVolume;
      logger.info('应用最终有效音量到视频元素', {
        masterVolume: volume.toFixed(3), // 播放器显示的主音量
        effectiveVolume: effectiveVolume.toFixed(3), // 实际应用的有效音量
        videoCurrentTime: videoRef.current.currentTime?.toFixed(2) || '0.00',
        note: '有效音量 = 轨道音量 × 主音量',
        timestamp: new Date().toISOString()
      });
    }
  }, [effectiveVolume, volume, logger]);

  // 新增：音频同步播放管理
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [activeAudioSequences, setActiveAudioSequences] = useState<Set<string>>(new Set());

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

  // 创建稳定的第一个视频序列标识符，避免useEffect过度触发
  const firstSequenceId = useMemo(() => {
    return compositionPlayback?.videoSequences?.[0]?.id || null;
  }, [compositionPlayback?.videoSequences?.[0]?.id]);

  // 新增：音频管理函数 - 创建或获取音频元素
  const getOrCreateAudioElement = useCallback((audioSequence: any) => {
    const audioId = audioSequence.id;
    let audioElement = audioElementsRef.current.get(audioId);
    
    if (!audioElement) {
      audioElement = new Audio();
      audioElement.crossOrigin = 'anonymous';
      
      // 设置音频属性
      audioElement.src = audioSequence.url;
      // 限制音量在[0, 1]范围内，HTML Audio API要求
      const clampedVolume = Math.max(0, Math.min(audioSequence.volume ?? 1, 1));
      audioElement.volume = clampedVolume;
      audioElement.preload = 'metadata';
      
      // 如果原始音量超出范围，记录警告
      if ((audioSequence.volume ?? 1) !== clampedVolume) {
        logger.warn('音频音量超出HTML Audio API范围，已自动限制', {
          audioId: audioSequence.id,
          originalVolume: audioSequence.volume?.toFixed(2) || '1.00',
          clampedVolume: clampedVolume.toFixed(2),
          note: 'HTML Audio API音量范围为[0, 1]'
        });
      }
      
      // 添加事件监听器
      audioElement.addEventListener('loadedmetadata', () => {
        logger.info('音频元数据加载完成', {
          audioId: audioSequence.id,
          audioName: audioSequence.name,
          duration: audioElement!.duration,
          clipStart: audioSequence.clipStart?.toFixed(2) || '0.00',
          clipEnd: audioSequence.clipEnd?.toFixed(2) || 'N/A'
        });
      });

      audioElement.addEventListener('error', (error) => {
        logger.error('音频加载失败', error as any, {
          audioId: audioSequence.id,
          audioName: audioSequence.name,
          audioUrl: audioSequence.url
        });
      });

      audioElementsRef.current.set(audioId, audioElement);
      
      logger.info('创建新的音频元素', {
        audioId: audioSequence.id,
        audioName: audioSequence.name,
        audioUrl: audioSequence.url,
        volume: audioSequence.volume?.toFixed(2) || '1.00',
        totalAudioElements: audioElementsRef.current.size
      });
    }
    
    return audioElement;
  }, [logger]);

  // 新增：计算当前时间应该播放的音频序列
  const getActiveAudioSequencesAtTime = useCallback((currentTime: number) => {
    if (!compositionPlayback?.audioSequences) return [];
    
    return compositionPlayback.audioSequences.filter(audioSeq => {
      const startTime = audioSeq.startTime;
      const endTime = audioSeq.startTime + audioSeq.duration;
      return currentTime >= startTime && currentTime < endTime;
    });
  }, [compositionPlayback?.audioSequences]);

  // 新增：同步音频播放状态
  const syncAudioPlayback = useCallback(async (currentTime: number, isPlaying: boolean) => {
    if (!compositionPlayback?.audioSequences || compositionPlayback.audioSequences.length === 0) {
      return;
    }

    const activeSequences = getActiveAudioSequencesAtTime(currentTime);
    const activeIds = new Set<string>(activeSequences.map(seq => seq.id));
    
    logger.info('同步音频播放状态', {
      currentTime: currentTime.toFixed(2),
      isPlaying,
      totalAudioSequences: compositionPlayback.audioSequences.length,
      activeAudioSequences: activeSequences.length,
      activeSequenceNames: activeSequences.map(seq => seq.name),
      action: isPlaying ? '开始播放音频' : '暂停音频'
    });

    // 停止不再活跃的音频
    for (const [audioId, audioElement] of Array.from(audioElementsRef.current.entries())) {
      if (!activeIds.has(audioId) && !audioElement.paused) {
        audioElement.pause();
        logger.info('停止不再活跃的音频', { audioId });
      }
    }

    // 处理当前应该播放的音频
    for (const audioSeq of activeSequences) {
      const audioElement = getOrCreateAudioElement(audioSeq);
      const audioStartTime = audioSeq.startTime;
      const relativeTime = currentTime - audioStartTime;
      
      // 计算音频在原始文件中的实际播放位置（考虑裁剪）
      const clipStart = audioSeq.clipStart ?? 0;
      const clipEnd = audioSeq.clipEnd ?? audioSeq.originalDuration ?? audioSeq.duration;
      const clipDuration = clipEnd - clipStart;
      const actualAudioTime = clipStart + (relativeTime * clipDuration / audioSeq.duration);
      
      // 确保音频时间在有效范围内
      const clampedAudioTime = Math.max(clipStart, Math.min(actualAudioTime, clipEnd));
      
      if (isPlaying) {
        // 设置音频播放位置
        if (Math.abs(audioElement.currentTime - clampedAudioTime) > 0.1) {
          audioElement.currentTime = clampedAudioTime;
        }
        
        // 开始播放音频
        if (audioElement.paused) {
          try {
            await audioElement.play();
            logger.info('开始播放音频序列', {
              audioId: audioSeq.id,
              audioName: audioSeq.name,
              timelineCurrentTime: currentTime.toFixed(2),
              relativeTime: relativeTime.toFixed(2),
              clipStart: clipStart.toFixed(2),
              clipEnd: clipEnd.toFixed(2),
              actualAudioTime: clampedAudioTime.toFixed(2),
              volume: audioSeq.volume?.toFixed(2) || '1.00'
            });
          } catch (error) {
            logger.error('音频播放失败', error as Error, {
              audioId: audioSeq.id,
              audioName: audioSeq.name
            });
          }
        }
      } else {
        // 暂停音频
        if (!audioElement.paused) {
          audioElement.pause();
          logger.info('暂停音频序列', {
            audioId: audioSeq.id,
            audioName: audioSeq.name
          });
        }
      }
    }

    setActiveAudioSequences(activeIds);
  }, [compositionPlayback?.audioSequences, getActiveAudioSequencesAtTime, getOrCreateAudioElement, logger]);

  // 新增：获取当前时间的图片叠加项
  const getCurrentImageOverlays = useCallback(() => {
    if (!timelineState) {
      console.log('[VideoPlayerPanel] No timeline state available for image overlays');
      return [];
    }

    // 使用多个时间源，优先使用有效的时间
    const currentPlaybackTime = compositionCurrentTime || currentTime || timelineState.currentTime || 0;
    
    console.log('[VideoPlayerPanel] Getting image overlays', {
      currentPlaybackTime: currentPlaybackTime.toFixed(2),
      compositionCurrentTime: compositionCurrentTime.toFixed(2),
      currentTime: currentTime.toFixed(2),
      timelineCurrentTime: timelineState.currentTime.toFixed(2),
      tracksCount: timelineState.tracks.length,
      materialsCount: materials?.length || 0
    });

    const imageOverlays: Array<{
      id: string;
      url: string;
      position: ImagePosition;
      materialId?: string;
    }> = [];

    // 遍历所有轨道，找到图片轨道中的图片素材
    timelineState.tracks.forEach(track => {
      console.log(`[VideoPlayerPanel] Checking track: ${track.id} (type: ${track.type}, items: ${track.items.length})`);
      
      if (track.id === 'image-track-1' || track.type === 'video') {
        track.items.forEach(item => {
          console.log(`[VideoPlayerPanel] Checking item: ${item.id}`, {
            originalMaterialType: item.originalMaterialType,
            startTime: item.startTime,
            duration: item.duration,
            endTime: item.startTime + item.duration,
            currentTime: currentPlaybackTime,
            isInTimeRange: currentPlaybackTime >= item.startTime && currentPlaybackTime < item.startTime + item.duration,
            materialId: item.materialId
          });
          
          // 检查是否为图片类型且在当前时间范围内
          if (item.originalMaterialType === 'image' && 
              currentPlaybackTime >= item.startTime && 
              currentPlaybackTime < item.startTime + item.duration) {
            
            // 查找对应的素材
            const material = materials?.find(m => m.id === item.materialId);
            console.log(`[VideoPlayerPanel] Found material for item ${item.id}:`, material);
            
            if (material && material.url) {
              // 为图片设置默认位置（如果没有设置的话）
              const defaultPosition: ImagePosition = {
                x: 0.1,
                y: 0.1,
                width: 0.3,
                height: 0.3,
                zIndex: 10
              };

              const overlay = {
                id: item.id,
                url: material.url,
                position: item.imagePosition || defaultPosition,
                materialId: item.materialId
              };

              console.log(`[VideoPlayerPanel] Adding image overlay:`, overlay);
              imageOverlays.push(overlay);
            } else {
              console.warn(`[VideoPlayerPanel] No material found for item ${item.id} with materialId ${item.materialId}`);
            }
          }
        });
      }
    });

    console.log(`[VideoPlayerPanel] Total image overlays found: ${imageOverlays.length}`, imageOverlays);
    return imageOverlays;
  }, [timelineState, compositionCurrentTime, currentTime, materials]);

  // 新增：处理图片位置变化
  const handleImagePositionChange = useCallback((itemId: string, newPosition: ImagePosition) => {
    logger.info('图片叠加位置更新', {
      itemId,
      newPosition,
      timestamp: new Date().toISOString()
    });

    // 调用外部回调更新timeline状态
    onImagePositionChange?.(itemId, newPosition);
  }, [onImagePositionChange, logger]);

  // 新增：处理图片选择
  const handleImageOverlaySelect = useCallback((itemId: string) => {
    setSelectedImageOverlay(itemId);
    logger.info('选择图片叠加', { itemId });
  }, [logger]);

  // 新增：监听容器尺寸变化
  useEffect(() => {
    const updateContainerDimensions = () => {
      if (videoContainerRef.current) {
        const rect = videoContainerRef.current.getBoundingClientRect();
        const newDimensions = {
          width: rect.width,
          height: rect.height
        };
        
        console.log('[VideoPlayerPanel] Container dimensions updated:', {
          previous: containerDimensions,
          new: newDimensions,
          element: videoContainerRef.current.className
        });
        
        setContainerDimensions(newDimensions);
      } else {
        console.warn('[VideoPlayerPanel] Video container ref not available');
      }
    };

    // 多次尝试更新尺寸以确保获取到正确的值
    const timers = [
      setTimeout(updateContainerDimensions, 100),
      setTimeout(updateContainerDimensions, 500),
      setTimeout(updateContainerDimensions, 1000)
    ];
    
    updateContainerDimensions();
    
    window.addEventListener('resize', updateContainerDimensions);

    return () => {
      timers.forEach(timer => clearTimeout(timer));
      window.removeEventListener('resize', updateContainerDimensions);
    };
  }, []);

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
      compositionAudioSequencesCount: compositionPlayback?.audioSequences.length || 0,
      initialAspectRatio: selectedAspectRatio.id,
      layoutStructure: '视频预览容器占用大部分高度，比例选择器在信息面板第二行',
      uiDesign: '两行布局：第一行显示视频信息，第二行显示比例选择器，整体高度紧凑',
      placeholderDesign: '占位符充满整个预览容器，无图标设计，仅显示文本和比例信息'
    });
  }, []);

  // 新增：监听compositionPlayback变化，当有视频序列时自动设置第一个视频
  useEffect(() => {
    if (playbackMode === 'composition' && compositionPlayback && compositionPlayback.videoSequences.length > 0 && videoRef.current) {
      const firstSequence = compositionPlayback.videoSequences[0];
      const clipStart = firstSequence.clipStart || 0;
      
      // 检查是否需要更新视频源（避免重复设置相同的src）
      const currentSrc = videoRef.current.src;
      const newSrc = firstSequence.url;
      const currentVideoTime = videoRef.current.currentTime;
      
      if (currentSrc !== newSrc || Math.abs(currentVideoTime - clipStart) > 0.1) {
        logger.info('自动设置视频合成播放的首个视频', {
          sequenceIndex: 0,
          sequenceName: firstSequence.name,
          sequenceUrl: firstSequence.url,
          clipStart: clipStart.toFixed(2),
          clipEnd: firstSequence.clipEnd?.toFixed(2) || 'N/A',
          originalDuration: firstSequence.originalDuration?.toFixed(2) || 'N/A',
          timelineStartTime: firstSequence.startTime.toFixed(2),
          timelineDuration: firstSequence.duration.toFixed(2),
          currentSrc: currentSrc,
          needsUpdate: currentSrc !== newSrc,
          action: '设置视频源并显示第一帧，保持暂停状态'
        });

        // 只在需要时设置视频源
        if (currentSrc !== newSrc) {
          videoRef.current.src = firstSequence.url;
        }
        // 设置到裁剪起始位置（或视频开始位置）
        videoRef.current.currentTime = clipStart;
        // 确保视频处于暂停状态
        videoRef.current.pause();
        // 重置组合播放状态（仅在状态确实不同时更新）
        if (isCompositionPlaying) {
          setIsCompositionPlaying(false);
        }
        if (compositionCurrentTime !== 0) {
          setCompositionCurrentTime(0);
        }
        
        logger.info('视频合成播放器状态已重置', {
          videoSrc: firstSequence.url,
          videoCurrentTime: clipStart.toFixed(2),
          isCompositionPlaying: false,
          compositionCurrentTime: 0,
          srcChanged: currentSrc !== newSrc,
          message: '视频已准备就绪，显示第一帧画面，等待用户播放'
        });
      }
    }
  }, [playbackMode, compositionPlayback?.videoSequences.length, firstSequenceId]);

  // 新增：音频序列变化时清理旧的音频元素
  useEffect(() => {
    // 当音频序列发生变化时，清理不再需要的音频元素
    if (compositionPlayback?.audioSequences) {
      const currentAudioIds = new Set(compositionPlayback.audioSequences.map(seq => seq.id));
      for (const [audioId, audioElement] of Array.from(audioElementsRef.current.entries())) {
        if (!currentAudioIds.has(audioId)) {
          audioElement.pause();
          audioElement.src = '';
          audioElementsRef.current.delete(audioId);
          logger.info('清理未使用的音频元素', { audioId });
        }
      }
    }
  }, [compositionPlayback?.audioSequences]);

  // 新增：组件卸载时清理音频元素
  useEffect(() => {
    return () => {
      // 组件卸载时清理所有音频元素
      for (const [audioId, audioElement] of Array.from(audioElementsRef.current.entries())) {
        audioElement.pause();
        audioElement.src = '';
        audioElement.removeEventListener('loadedmetadata', () => {});
        audioElement.removeEventListener('error', () => {});
      }
      audioElementsRef.current.clear();
      setActiveAudioSequences(new Set());
      logger.info('组件卸载 - 清理所有音频元素');
    };
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

          // 新增：切换到下一个视频时同步音频
          const nextVideoStartTime = compositionPlayback.videoSequences.slice(0, nextIndex).reduce((sum, seq) => sum + seq.duration, 0);
          syncAudioPlayback(nextVideoStartTime, true).catch(error => {
            logger.error('切换视频时音频同步失败', error as Error, {
              nextIndex,
              sequenceName: nextSequence.name
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
        
        // 新增：停止所有音频
        syncAudioPlayback(compositionPlayback.totalCompositionDuration, false).catch(error => {
          logger.error('组合播放完毕时停止音频失败', error as Error);
        });
        
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

      // 新增：同步音频播放（仅在播放时）
      if (isCompositionPlaying) {
        syncAudioPlayback(accumulatedTime, true).catch(error => {
          logger.error('音频同步失败', error as Error, {
            currentTime: accumulatedTime.toFixed(2)
          });
        });
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

      // 新增：预览模式下的音频同步（仅在播放时）
      if (isPlaying && compositionPlayback?.audioSequences && compositionPlayback.audioSequences.length > 0) {
        syncAudioPlayback(videoCurrentTime, true).catch(error => {
          logger.error('预览模式音频同步失败', error as Error, {
            currentTime: videoCurrentTime.toFixed(2)
          });
        });
      }
    }
  }, [playbackMode, compositionPlayback, isCompositionPlaying, isPlaying, onCompositionTimeUpdate, onTimelineTimeUpdate, handleVideoEnded, syncAudioPlayback, logger]);

  // 处理播放/暂停点击
  const handlePlayPauseClick = useCallback(async () => {
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
          // 新增：同步暂停音频
          await syncAudioPlayback(compositionCurrentTime, false);
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

              // 新增：同步播放音频
              await syncAudioPlayback(startTime, true);
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
      
      // 新增：预览模式下也要同步音频播放
      if (compositionPlayback?.audioSequences && compositionPlayback.audioSequences.length > 0) {
        const newIsPlaying = !isPlaying;
        await syncAudioPlayback(currentTime, newIsPlaying);
        logger.info('预览模式音频同步', {
          currentTime: currentTime.toFixed(2),
          newIsPlaying,
          audioSequencesCount: compositionPlayback.audioSequences.length
        });
      }
    }
  }, [playbackMode, isCompositionPlaying, compositionPlayback, compositionCurrentTime, isPlaying, currentTime, videoPreview.duration, onCompositionPlayPause, handlePlayPause, syncAudioPlayback, logger]);

  // 处理时间跳转
  const handleTimeSeekClick = useCallback(async (newTime: number) => {
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
        
        // 新增：同步音频时间跳转
        await syncAudioPlayback(newTime, isCompositionPlaying);
      }

      if (onCompositionSeek) {
        onCompositionSeek(newTime);
      }
    } else {
      // 原有的预览模式时间跳转
      handleTimeSeek(newTime);
      
      // 新增：预览模式下的音频时间跳转
      if (compositionPlayback?.audioSequences && compositionPlayback.audioSequences.length > 0) {
        await syncAudioPlayback(newTime, isPlaying);
        logger.info('预览模式音频时间跳转', {
          newTime: newTime.toFixed(2),
          isPlaying,
          audioSequencesCount: compositionPlayback.audioSequences.length
        });
      }
    }
  }, [playbackMode, compositionPlayback, compositionCurrentTime, isCompositionPlaying, isPlaying, onCompositionSeek, handleTimeSeek, syncAudioPlayback, logger]);

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
        title: `${t.videoPlayerPanel.playback.compositionPlay} (${compositionPlayback.currentSequenceIndex + 1}/${compositionPlayback.videoSequences.length}): ${currentSequence?.name || t.videoPlayerPanel.info.unknown}`,
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
      aria-label={t.videoPlayerPanel.accessibility.videoCompositionPanel}
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
              {playbackMode === 'composition' ? t.videoPlayerPanel.playback.videoCompositionPlayback : t.videoPlayerPanel.playback.videoPreviewPlayback}
            </h3>
            {playbackMode === 'composition' && (
              <div className="flex items-center space-x-2">
                <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
                  {compositionPlayback?.videoSequences.length || 0} {t.videoPlayerPanel.playback.videosCount}
                </span>
                {compositionPlayback?.audioSequences && compositionPlayback.audioSequences.length > 0 && (
                                      <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded">
                      {compositionPlayback.audioSequences.length} {t.videoPlayerPanel.playback.audioCount}
                    </span>
                )}
              </div>
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
              aria-label={videoExport.isExporting ? `${t.videoPlayerPanel.export.exporting} (${selectedAspectRatio.id})...` : `${t.videoPlayerPanel.export.exportVideo} (${selectedAspectRatio.id})`}
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
                      ? t.videoPlayerPanel.export.exportingProgress.replace('{progress}', Math.round(videoExport.exportProgress).toString())
                      : t.videoPlayerPanel.export.exporting
                    }
                  </span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
                  </svg>
                  <span>{t.videoPlayerPanel.export.exportVideo}</span>
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
            <div 
              ref={videoContainerRef}
              className="video-preview-container flex-1 flex items-center justify-center bg-gray-100 rounded-xl overflow-hidden relative">
              {playbackMode === 'composition' && compositionPlayback && compositionPlayback.videoSequences.length > 0 ? (
                // 组合播放模式
                <div 
                  className={`${selectedAspectRatio.cssClass} bg-black rounded-xl overflow-hidden shadow-lg relative`} 
                  style={{ maxHeight: '100%', maxWidth: '100%' }}
                  onClick={() => setSelectedImageOverlay(null)} // 点击空白处取消选择
                >
                  <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    preload="metadata"
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
                    onLoadedMetadata={() => {
                      logger.info('组合视频元数据加载完成', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        duration: videoRef.current?.duration,
                        videoWidth: videoRef.current?.videoWidth,
                        videoHeight: videoRef.current?.videoHeight,
                        currentTime: videoRef.current?.currentTime?.toFixed(2),
                        aspectRatio: selectedAspectRatio.id,
                        message: '视频元数据已加载，第一帧应该可见'
                      });
                    }}
                    onSeeked={() => {
                      logger.info('组合视频跳转完成', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        currentTime: videoRef.current?.currentTime?.toFixed(2),
                        message: '视频已跳转到指定时间点'
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
                  
                  {/* 新增：图片叠加层 */}
                  {(() => {
                    const overlays = getCurrentImageOverlays();
                    console.log('[VideoPlayerPanel] Rendering image overlays:', {
                      overlayCount: overlays.length,
                      containerDimensions,
                      hasValidDimensions: containerDimensions.width > 0 && containerDimensions.height > 0,
                      overlays: overlays.map(o => ({
                        id: o.id,
                        url: o.url,
                        position: o.position
                      }))
                    });
                    
                    if (containerDimensions.width === 0 || containerDimensions.height === 0) {
                      console.warn('[VideoPlayerPanel] Container dimensions are zero, overlays will not be visible');
                    }
                    
                    return overlays.map((overlay) => (
                      <ImageOverlay
                        key={overlay.id}
                        imageId={overlay.id}
                        imageUrl={overlay.url}
                        position={overlay.position}
                        containerWidth={containerDimensions.width}
                        containerHeight={containerDimensions.height}
                        onPositionChange={(newPosition) => handleImagePositionChange(overlay.id, newPosition)}
                        isSelected={selectedImageOverlay === overlay.id}
                        onSelect={() => handleImageOverlaySelect(overlay.id)}
                      />
                    ));
                  })()}
                </div>
              ) : (
                // 预览模式占位符 - 充满整个容器
                <div 
                  className="video-placeholder-container relative"
                  onClick={() => setSelectedImageOverlay(null)}
                >
                  {/* 比例预览框 */}
                  <div className={`${selectedAspectRatio.cssClass} video-placeholder-frame`}>
                    <div className="placeholder-content">
                      <p className="placeholder-text">
                        {playbackMode === 'composition' 
                          ? t.videoPlayerPanel.placeholders.noMaterialsInTimeline
                          : t.videoPlayerPanel.placeholders.clickPlayToPreview}
                      </p>
                      <div className="placeholder-aspect-info">
                        {t.videoPlayerPanel.placeholders.currentAspectRatioLabel}: {selectedAspectRatio.label} ({selectedAspectRatio.description})
                      </div>
                    </div>
                  </div>
                  
                  {/* 在预览模式下也显示图片叠加 */}
                  {(() => {
                    const overlays = getCurrentImageOverlays();
                    console.log('[VideoPlayerPanel] Rendering image overlays in preview mode:', {
                      overlayCount: overlays.length,
                      containerDimensions,
                      playbackMode: 'preview'
                    });
                    
                    return overlays.map((overlay) => (
                      <ImageOverlay
                        key={overlay.id}
                        imageId={overlay.id}
                        imageUrl={overlay.url}
                        position={overlay.position}
                        containerWidth={containerDimensions.width}
                        containerHeight={containerDimensions.height}
                        onPositionChange={(newPosition) => handleImagePositionChange(overlay.id, newPosition)}
                        isSelected={selectedImageOverlay === overlay.id}
                        onSelect={() => handleImageOverlaySelect(overlay.id)}
                      />
                    ));
                  })()}
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
                  title={getCurrentlyPlaying() ? t.videoPlayerPanel.playback.pause : t.videoPlayerPanel.playback.play}
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
                    title={t.videoPlayerPanel.controls.volume}
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
                  title={t.videoPlayerPanel.controls.playbackSpeed}
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
                  title={t.videoPlayerPanel.controls.fullscreen}
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
                  <span className="info-label">{t.videoPlayerPanel.info.title}</span>
                  <span className="info-value info-title">{currentVideoInfo.title}</span>
                </div>
                <div className="info-separator"></div>
                <div className="info-item-inline">
                  <span className="info-label">{t.videoPlayerPanel.info.resolution}</span>
                  <span className="info-value">{currentVideoInfo.resolution.width}×{currentVideoInfo.resolution.height}</span>
                </div>
                <div className="info-separator"></div>
                <div className="info-item-inline">
                  <span className="info-label">{t.videoPlayerPanel.info.frameRate}</span>
                  <span className="info-value">{currentVideoInfo.frameRate}fps</span>
                </div>
                <div className="info-separator"></div>
                <div className="info-item-inline">
                  <span className="info-label">{t.videoPlayerPanel.info.format}</span>
                  <span className="info-value">{currentVideoInfo.format}</span>
                </div>
              </div>
            </div>
            
            {/* 第二行：视频比例选择器 */}
            <div className="aspect-ratio-row">
              <div className="aspect-ratio-group">
                <span className="info-label">{t.videoPlayerPanel.info.aspectRatio}</span>
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
                      aria-label={`${t.videoPlayerPanel.accessibility.selectAspectRatio} ${aspectRatio.description}`}
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