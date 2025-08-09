'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { UseVideoPlaybackReturn, VideoPreview, CompositionPlayback, VideoSequenceItem } from '../../types';
import { VideoEditingLogger } from '../../utils/logger';

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
  onSequenceIndexUpdate
}) => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoPlayerPanel'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCompositionPlaying, setIsCompositionPlaying] = useState(false);
  const [compositionCurrentTime, setCompositionCurrentTime] = useState(0);

  // 当前播放模式：preview 或 composition
  const playbackMode = compositionPlayback?.isCompositionMode && compositionPlayback.videoSequences.length > 0 
    ? 'composition' : 'preview';

  useEffect(() => {
    logger.info('组件初始化', {
      isPlaying,
      currentTime,
      volume,
      playbackRate,
      videoTitle: videoPreview.title,
      videoDuration: videoPreview.duration,
      playbackMode,
      compositionSequencesCount: compositionPlayback?.videoSequences.length || 0
    });
  }, []);

  // 组合播放时的视频切换逻辑
  const handleVideoEnded = useCallback(() => {
    if (playbackMode === 'composition' && compositionPlayback && onNextSequence) {
      const currentIndex = compositionPlayback.currentSequenceIndex;
      const nextIndex = currentIndex + 1;
      
      logger.info('视频播放结束，尝试切换到下一个', {
        currentIndex,
        nextIndex,
        totalSequences: compositionPlayback.videoSequences.length,
        currentSequence: compositionPlayback.videoSequences[currentIndex]?.name
      });

      // 检查是否有下一个视频
      if (nextIndex < compositionPlayback.videoSequences.length) {
        const nextSequence = compositionPlayback.videoSequences[nextIndex];
        
        // 先切换状态
        const hasNext = onNextSequence();
        
        if (hasNext && nextSequence && videoRef.current) {
          logger.info('加载下一个视频', {
            nextIndex,
            sequenceName: nextSequence.name,
            sequenceUrl: nextSequence.url
          });
          
          // 直接使用nextSequence，因为我们知道它是下一个
          videoRef.current.src = nextSequence.url;
          videoRef.current.currentTime = 0; // 重置到开头
          videoRef.current.play().catch(error => {
            logger.error('自动播放下一个视频失败', error, {
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
      
      for (let i = 0; i < compositionPlayback.videoSequences.length; i++) {
        const sequence = compositionPlayback.videoSequences[i];
        if (currentVideoSrc.includes(sequence.url) || sequence.url.includes(currentVideoSrc.split('/').pop() || '')) {
          actualSequenceIndex = i;
          foundSequence = true;
          break;
        }
      }
      
      // 如果没有找到匹配的序列，使用状态中的索引作为后备
      if (!foundSequence) {
        actualSequenceIndex = compositionPlayback.currentSequenceIndex;
        logger.warn('未找到匹配的视频序列，使用状态中的索引', {
          currentVideoSrc,
          fallbackIndex: actualSequenceIndex
        });
      }
      
      // 计算组合播放的总时间，使用实际的序列索引
      let accumulatedTime = 0;
      for (let i = 0; i < actualSequenceIndex; i++) {
        accumulatedTime += compositionPlayback.videoSequences[i].duration;
      }
      accumulatedTime += videoCurrentTime;
      
      setCompositionCurrentTime(accumulatedTime);
      
      logger.info('组合播放时间更新', {
        videoCurrentTime: videoCurrentTime.toFixed(2),
        stateSequenceIndex: compositionPlayback.currentSequenceIndex,
        actualSequenceIndex: actualSequenceIndex,
        accumulatedTime: accumulatedTime.toFixed(2),
        totalSequences: compositionPlayback.videoSequences.length,
        foundSequence
      });
      
      // 通知父组件时间更新
      if (onCompositionTimeUpdate) {
        onCompositionTimeUpdate(accumulatedTime);
      }

      // 同步时间到timeline（关键修改）
      if (onTimelineTimeUpdate) {
        logger.info('同步时间到timeline', {
          currentTime: accumulatedTime.toFixed(2),
          playbackMode: 'composition',
          actualSequenceIndex
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
  }, [playbackMode, compositionPlayback, onCompositionTimeUpdate, onTimelineTimeUpdate, logger]);

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
              logger.info('开始组合播放，从timeline当前位置开始', {
                timelineCurrentTime: startTime.toFixed(2),
                targetSequenceIndex,
                targetSequenceName: targetSequence.name,
                targetSequenceUrl: targetSequence.url,
                targetVideoTime: targetVideoTime.toFixed(2),
                accumulatedTime: accumulatedTime.toFixed(2)
              });
              
              videoRef.current.src = targetSequence.url;
              videoRef.current.currentTime = Math.max(0, targetVideoTime); // 从计算的时间开始
              setCompositionCurrentTime(startTime);
              
              // 更新当前序列索引
              if (compositionPlayback.currentSequenceIndex !== targetSequenceIndex) {
                logger.info('播放开始时切换视频序列', {
                  previousSequenceIndex: compositionPlayback.currentSequenceIndex,
                  newSequenceIndex: targetSequenceIndex
                });
                
                if (onSequenceIndexUpdate) {
                  onSequenceIndexUpdate(targetSequenceIndex);
                }
              }
              
              videoRef.current.play().catch(error => {
                logger.error('开始播放组合视频失败', error, {
                  sequenceIndex: targetSequenceIndex,
                  sequenceName: targetSequence.name,
                  startTime: targetVideoTime.toFixed(2)
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
      </div>
      
      <div className="composition-panel-content">
        <div className="video-player-container">
          {/* 视频播放器区域 */}
          <div className="video-player-wrapper">
            {playbackMode === 'composition' && compositionPlayback && compositionPlayback.videoSequences.length > 0 ? (
              // 组合播放模式
              <div className="aspect-video bg-black rounded-xl overflow-hidden">
                                  <video
                    ref={videoRef}
                    className="w-full h-full object-contain"
                    onEnded={handleVideoEnded}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadStart={() => {
                      logger.info('组合视频开始加载', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name
                      });
                    }}
                    onCanPlay={() => {
                      logger.info('组合视频可播放', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name
                      });
                    }}
                    onLoadedData={() => {
                      logger.info('组合视频数据加载完成', {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        duration: videoRef.current?.duration
                      });
                    }}
                    onError={(e) => {
                      logger.error('组合视频加载失败', new Error('Video load error'), {
                        sequenceIndex: compositionPlayback.currentSequenceIndex,
                        sequenceName: compositionPlayback.videoSequences[compositionPlayback.currentSequenceIndex]?.name,
                        error: e.currentTarget.error?.message
                      });
                    }}
                  />
              </div>
            ) : (
              // 原有的预览模式
              <div className="video-placeholder">
                <div className="placeholder-content">
                  <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-500 text-center">
                    {playbackMode === 'composition' 
                      ? '时间轴中没有视频素材\n请在时间轴中添加视频素材后播放'
                      : '点击播放按钮预览视频'}
                  </p>
                </div>
              </div>
            )}
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
            <div className="info-row">
              <div className="info-item">
                <span className="info-label">标题:</span>
                <span className="info-value">{currentVideoInfo.title}</span>
              </div>
            </div>
            <div className="info-row">
              <div className="info-item">
                <span className="info-label">分辨率:</span>
                <span className="info-value">{currentVideoInfo.resolution.width}×{currentVideoInfo.resolution.height}</span>
              </div>
              <div className="info-item">
                <span className="info-label">帧率:</span>
                <span className="info-value">{currentVideoInfo.frameRate}fps</span>
              </div>
              <div className="info-item">
                <span className="info-label">格式:</span>
                <span className="info-value">{currentVideoInfo.format}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerPanel; 