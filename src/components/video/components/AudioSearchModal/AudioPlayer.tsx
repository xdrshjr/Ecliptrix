'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VideoEditingLogger } from '../../utils/logger';

interface AudioPlayerProps {
  audioUrl: string;
  audioId: number;
  audioName: string;
  duration: number;
  taskId: string;
  isPlaying: boolean;
  onPlayStateChange: (isPlaying: boolean) => void;
  onError: (error: Error) => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  audioId,
  audioName,
  duration,
  taskId,
  isPlaying,
  onPlayStateChange,
  onError
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const loggerRef = useRef<VideoEditingLogger>();
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  // 初始化logger，避免重复创建
  if (!loggerRef.current) {
    loggerRef.current = new VideoEditingLogger({
      taskId,
      component: 'AudioPlayer'
    });
  }
  const logger = loggerRef.current;

  // 格式化时间显示
  const formatTime = useCallback((seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  // 初始化音频元素 - 只依赖audioUrl
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    // 避免重复设置相同的src
    if (audio.src !== audioUrl) {
      audio.src = audioUrl;
      setCurrentTime(0);
      setIsLoading(true);
      
      logger.debug('音频URL变更，重新加载', {
        audioId,
        audioName,
        audioUrl
      });
    }

    const handleLoadStart = () => {
      setIsLoading(true);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
      logger.debug('音频可以播放', {
        audioId,
        audioName,
        duration: audio.duration
      });
    };

    const handleTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(audio.currentTime);
      }
    };

    const handleEnded = () => {
      setCurrentTime(0);
      onPlayStateChange(false);
      logger.info('音频播放结束', {
        audioId,
        audioName,
        playedDuration: audio.currentTime
      });
    };

    const handleError = () => {
      setIsLoading(false);
      const error = new Error('音频加载失败');
      onError(error);
      logger.error('音频播放错误', error, {
        audioId,
        audioName,
        audioUrl
      });
    };

    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl]); // 只依赖audioUrl

  // 控制播放状态
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.play().catch((error) => {
        logger.error('音频播放失败', error, {
          audioId,
          audioName
        });
        onError(error);
        onPlayStateChange(false);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  // 音量控制
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  // 播放/暂停切换
  const handlePlayPause = () => {
    const newPlayState = !isPlaying;
    onPlayStateChange(newPlayState);
    
    logger.userAction(
      newPlayState ? '开始播放音频' : '暂停播放音频',
      newPlayState ? 'audioPlay' : 'audioPause',
      {
        audioId,
        audioName,
        currentTime,
        duration
      }
    );
  };

  // 进度条拖拽处理
  const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleProgressChange(e);
  };

  const handleProgressChange = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = Math.max(0, Math.min(duration, percent * duration));
    
    setCurrentTime(newTime);
    audio.currentTime = newTime;

    logger.userAction('跳转音频播放位置', 'audioSeek', {
      audioId,
      audioName,
      fromTime: currentTime,
      toTime: newTime,
      seekPercent: percent
    });
  };

  // 全局鼠标事件处理
  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  // 音量控制
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);

    logger.userAction('调整音频音量', 'audioVolumeChange', {
      audioId,
      audioName,
      fromVolume: volume,
      toVolume: newVolume
    });
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center space-x-3 w-full">
      <audio ref={audioRef} preload="metadata" />
      
      {/* 播放/暂停按钮 */}
      <button
        onClick={handlePlayPause}
        disabled={isLoading}
        className="flex-shrink-0 p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-full transition-colors disabled:opacity-50"
        title={isPlaying ? '暂停' : '播放'}
      >
        {isLoading ? (
          <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : isPlaying ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* 当前时间 */}
      <span className="flex-shrink-0 text-xs text-gray-500 w-10">
        {formatTime(currentTime)}
      </span>

      {/* 进度条 */}
      <div className="flex-1 relative">
        <div
          className="h-2 bg-gray-200 rounded-full cursor-pointer"
          onMouseDown={handleProgressMouseDown}
        >
          <div
            className="h-2 bg-blue-600 rounded-full relative transition-all duration-150"
            style={{ width: `${progressPercent}%` }}
          >
            <div className="absolute right-0 top-1/2 transform translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-blue-600 rounded-full shadow-sm" />
          </div>
        </div>
      </div>

      {/* 总时长 */}
      <span className="flex-shrink-0 text-xs text-gray-500 w-10">
        {formatTime(duration)}
      </span>

      {/* 音量控制 */}
      <div className="flex-shrink-0 flex items-center space-x-1">
        <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={volume}
          onChange={handleVolumeChange}
          className="w-16 h-1 bg-gray-200 rounded-full appearance-none cursor-pointer"
        />
      </div>
    </div>
  );
};

export default AudioPlayer; 