import { useState, useCallback, useEffect, useMemo } from 'react';
import { UseVideoPlaybackReturn, PreviewQuality } from '../types';
import { VideoEditingLogger } from '../utils';
import { mockVideoPreview } from '../data';

/**
 * useVideoPlayback Hook
 * 管理视频播放状态和控制
 * 
 * @param taskId - 任务ID，用于日志记录
 * @param onTimeUpdate - 时间更新回调，用于同步到timeline
 * @returns 视频播放相关的状态和控制方法
 */
export const useVideoPlayback = (
  taskId: string,
  onTimeUpdate?: (currentTime: number) => void,
  currentTimelineTime?: number,
  externalTrackVolume?: number // 重命名：外部轨道音量，来自timeline轨道计算
): UseVideoPlaybackReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoPlayback'
  }), [taskId]);

  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(45); // 当前播放时间（秒）
  const [masterVolume, setMasterVolume] = useState(0.8); // 主音量 (0-1)，由播放器控制
  const [playbackRate, setPlaybackRate] = useState(1.0); // 播放速度
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>('high');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // 新增：计算最终有效音量 = 轨道音量 × 主音量
  const trackVolume = externalTrackVolume !== undefined ? externalTrackVolume : 1.0; // 默认轨道音量为1.0
  const effectiveVolume = trackVolume * masterVolume;

  // 记录初始化日志
  useEffect(() => {
    logger.info('Hook初始化', {
      videoInfo: {
        title: mockVideoPreview.title,
        duration: mockVideoPreview.duration,
        resolution: `${mockVideoPreview.resolution.width}×${mockVideoPreview.resolution.height}`,
        format: mockVideoPreview.format
      },
      initialState: {
        isPlaying,
        currentTime,
        masterVolume, // 主音量
        trackVolume, // 轨道音量
        effectiveVolume, // 最终有效音量
        playbackRate,
        previewQuality
      }
    });
  }, []);

  // 新增：记录音量组合变化
  useEffect(() => {
    logger.info('音量组合更新', {
      trackVolume: trackVolume.toFixed(3),
      masterVolume: masterVolume.toFixed(3),
      effectiveVolume: effectiveVolume.toFixed(3),
      source: externalTrackVolume !== undefined ? 'timeline_track_volume' : 'default_track_volume',
      timestamp: new Date().toISOString()
    });
  }, [trackVolume, masterVolume, effectiveVolume, externalTrackVolume, logger]);

  // 播放/暂停控制
  const handlePlayPause = useCallback(() => {
    const newPlayingState = !isPlaying;
    
    logger.userAction('播放/暂停切换', 'playPauseButton', {
      previousState: isPlaying ? 'playing' : 'paused',
      newState: newPlayingState ? 'playing' : 'paused',
      currentTime,
      timelineTime: currentTimelineTime
    });

    // 如果开始播放且提供了timeline时间，则从timeline时间开始
    if (newPlayingState && currentTimelineTime !== undefined && currentTimelineTime !== currentTime) {
      logger.info('从timeline当前位置开始预览播放', {
        previousTime: currentTime.toFixed(2),
        timelineTime: currentTimelineTime.toFixed(2),
        timeDifference: (currentTimelineTime - currentTime).toFixed(2)
      });
      setCurrentTime(currentTimelineTime);
    }

    setIsPlaying(newPlayingState);
  }, [isPlaying, currentTime, currentTimelineTime, logger]);

  // 时间跳转
  const handleTimeSeek = useCallback((newTime: number) => {
    const clampedTime = Math.max(0, Math.min(newTime, mockVideoPreview.duration));
    
    logger.userAction('视频时间跳转', 'timeSlider', {
      previousTime: currentTime,
      newTime: clampedTime,
      duration: mockVideoPreview.duration,
      seekDelta: clampedTime - currentTime
    });

    setCurrentTime(clampedTime);
  }, [currentTime, logger]);

  // 音量控制
  const handleVolumeChange = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    
    logger.userAction('主音量调节', 'masterVolumeSlider', {
      previousMasterVolume: masterVolume,
      newMasterVolume: clampedVolume,
      masterVolumeDelta: clampedVolume - masterVolume,
      currentTrackVolume: trackVolume,
      previousEffectiveVolume: effectiveVolume,
      newEffectiveVolume: trackVolume * clampedVolume,
      isMuted: clampedVolume === 0
    });

    setMasterVolume(clampedVolume);
  }, [masterVolume, trackVolume, effectiveVolume, logger]);

  // 播放速度控制
  const handlePlaybackRateChange = useCallback((rate: number) => {
    logger.userAction('播放速度变更', 'speedSelect', {
      previousRate: playbackRate,
      newRate: rate,
      speedMultiplier: rate / playbackRate
    });

    setPlaybackRate(rate);
  }, [playbackRate, logger]);

  // 预览质量控制
  const handleQualityChange = useCallback((quality: PreviewQuality) => {
    logger.userAction('预览质量变更', 'qualitySelect', {
      previousQuality: previewQuality,
      newQuality: quality
    });

    setPreviewQuality(quality);
  }, [previewQuality, logger]);

  // 全屏模式切换
  const handleFullscreenToggle = useCallback(() => {
    const newFullscreenState = !isFullscreen;
    
    logger.userAction('全屏模式切换', 'fullscreenButton', {
      previousState: isFullscreen ? 'fullscreen' : 'normal',
      newState: newFullscreenState ? 'fullscreen' : 'normal'
    });

    setIsFullscreen(newFullscreenState);
  }, [isFullscreen, logger]);

  // 格式化时间显示
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // 模拟视频播放时间更新
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    
    if (isPlaying) {
      logger.info('开始视频播放模拟', {
        startTime: currentTime,
        playbackRate,
        duration: mockVideoPreview.duration
      });
      
      intervalId = setInterval(() => {
        setCurrentTime(prevTime => {
          const newTime = prevTime + playbackRate;
          if (newTime >= mockVideoPreview.duration) {
            logger.info('视频播放结束', {
              finalTime: mockVideoPreview.duration,
              totalDuration: mockVideoPreview.duration
            });
            
            setIsPlaying(false);
            return mockVideoPreview.duration;
          }
          
          // 同步时间到timeline（预览模式）
          if (onTimeUpdate) {
            logger.info('预览模式时间同步到timeline', {
              currentTime: newTime.toFixed(2),
              playbackRate
            });
            onTimeUpdate(newTime);
          }
          
          return newTime;
        });
      }, 1000);
    } else {
      logger.info('视频播放暂停', {
        pausedAt: currentTime,
        remainingTime: mockVideoPreview.duration - currentTime
      });
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isPlaying, playbackRate, logger]);

  // 注意：键盘快捷键支持已移至VideoEditingInterface级别，以支持全局空格键播放/暂停功能

  return {
    isPlaying,
    currentTime,
    volume: masterVolume, // 播放器控件显示的主音量，不受轨道音量影响
    effectiveVolume, // 实际应用到video元素的有效音量（轨道音量 × 主音量）
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
    formatTime
  };
};