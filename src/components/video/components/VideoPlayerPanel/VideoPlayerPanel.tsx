'use client';

import React, { useEffect } from 'react';
import { UseVideoPlaybackReturn, VideoPreview } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

interface VideoPlayerPanelProps extends UseVideoPlaybackReturn {
  videoPreview: VideoPreview;
  taskId: string;
  className?: string;
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
  className = ''
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoPlayerPanel'
  });

  useEffect(() => {
    logger.info('组件初始化', {
      isPlaying,
      currentTime,
      volume,
      playbackRate,
      videoTitle: videoPreview.title,
      videoDuration: videoPreview.duration
    });
  }, []);

  const handlePlayPauseClick = () => {
    logger.info('播放/暂停按钮点击', {
      currentState: isPlaying ? '播放中' : '已暂停',
      newState: isPlaying ? '暂停' : '播放',
      currentTime,
      duration: videoPreview.duration
    });
    
    handlePlayPause();
  };

  return (
    <div 
      className={`video-editing-composition-panel ${className}`}
      tabIndex={0}
      aria-label="视频合成播放面板"
    >
      <div className="composition-panel-header">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 bg-green-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h1m4 0h1m6-1a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">视频合成播放</h3>
        </div>
      </div>
      
      <div className="composition-panel-content">
        <div className="video-player-container">
          <div className="video-preview-window">
            <img 
              src={videoPreview.thumbnailUrl}
              alt="视频预览帧"
              className="w-full h-full object-cover rounded-lg"
            />
            <div className="video-overlay">
              <button
                onClick={handlePlayPauseClick}
                className="play-pause-btn"
                title={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                  </svg>
                ) : (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="video-controls">
            <div className="progress-container">
              <div className="progress-bar">
                <div 
                  className="progress-filled"
                  style={{ width: `${(currentTime / videoPreview.duration) * 100}%` }}
                ></div>
                <input
                  type="range"
                  min="0"
                  max={videoPreview.duration}
                  value={currentTime}
                  onChange={(e) => handleTimeSeek(Number(e.target.value))}
                  className="progress-slider"
                />
              </div>
            </div>

            <div className="controls-row">
              <div className="controls-left">
                <button
                  onClick={handlePlayPauseClick}
                  className="control-btn play-btn"
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>
                <span className="time-display">
                  {formatTime(currentTime)} / {formatTime(videoPreview.duration)}
                </span>
              </div>

              <div className="controls-right">
                <div className="speed-control">
                  <select
                    value={playbackRate}
                    onChange={(e) => handlePlaybackRateChange(Number(e.target.value))}
                    className="speed-select"
                  >
                    <option value={0.5}>0.5x</option>
                    <option value={1.0}>1.0x</option>
                    <option value={1.25}>1.25x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2.0}>2.0x</option>
                  </select>
                </div>

                <div className="volume-control">
                  <button 
                    className="control-btn volume-btn" 
                    title="音量"
                    onClick={() => handleVolumeChange(volume === 0 ? 0.8 : 0)}
                  >
                    {volume === 0 ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    )}
                  </button>
                </div>

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
            <div className="info-row">
              <div className="info-item">
                <span className="info-label">分辨率:</span>
                <span className="info-value">{videoPreview.resolution.width}×{videoPreview.resolution.height}</span>
              </div>
              <div className="info-item">
                <span className="info-label">帧率:</span>
                <span className="info-value">{videoPreview.frameRate}fps</span>
              </div>
              <div className="info-item">
                <span className="info-label">格式:</span>
                <span className="info-value">{videoPreview.format}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerPanel; 