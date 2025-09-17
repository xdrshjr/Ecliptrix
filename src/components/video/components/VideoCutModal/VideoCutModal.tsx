'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';

// 视频切片数据结构
export interface VideoClip {
  id: string;
  name: string;
  startTime: number; // 秒
  endTime: number; // 秒
  duration: number; // 秒
  thumbnailUrl?: string;
  createdAt: Date;
}

interface VideoCutModalProps {
  isOpen: boolean;
  material: MaterialItem | null;
  onClose: () => void;
  onClipCreated?: (clip: VideoClip) => void;
  onExportClips?: (clips: VideoClip[], originalMaterial: MaterialItem) => void;
  taskId: string;
}

const VideoCutModal: React.FC<VideoCutModalProps> = ({
  isOpen,
  material,
  onClose,
  onClipCreated,
  onExportClips,
  taskId
}) => {
  // 视频播放控制状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  
  // 剪切控制状态
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [clips, setClips] = useState<VideoClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  
  // 预览状态
  const [previewClip, setPreviewClip] = useState<VideoClip | null>(null);
  const [previewIsPlaying, setPreviewIsPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  
  // 拖拽状态
  const [isDragging, setIsDragging] = useState<'start' | 'end' | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);
  
  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  
  const logger = new VideoEditingLogger({
    taskId,
    component: 'VideoCutModal'
  });
  
  const { showSuccess, showError } = useNotification();
  const { t } = useLocale();

  // 重置状态当弹窗打开时
  useEffect(() => {
    if (isOpen && material) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setStartTime(0);
      setEndTime(0);
      setClips([]);
      setSelectedClipId(null);
      setPreviewClip(null);
      setPreviewIsPlaying(false);
      setPreviewCurrentTime(0);
      setIsDragging(null);
      setDragStartX(0);
      setDragStartTime(0);
      
      logger.info('视频剪切弹窗打开', {
        materialId: material.id,
        materialName: material.name,
        materialUrl: material.url.substring(0, 100)
      });
    }
  }, [isOpen, material?.id]);

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        handlePlayPause();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // 视频加载完成
  const handleLoadedMetadata = useCallback(() => {
    if (originalVideoRef.current) {
      const videoDuration = originalVideoRef.current.duration;
      setDuration(videoDuration);
      setEndTime(videoDuration);
      
      logger.info('原始视频加载完成', {
        duration: videoDuration,
        materialId: material?.id
      });
    }
  }, [material?.id, logger]);

  // 时间更新
  const handleTimeUpdate = useCallback(() => {
    if (originalVideoRef.current) {
      setCurrentTime(originalVideoRef.current.currentTime);
    }
  }, []);

  // 播放/暂停控制
  const handlePlayPause = useCallback(() => {
    if (originalVideoRef.current) {
      if (isPlaying) {
        originalVideoRef.current.pause();
      } else {
        originalVideoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  }, [isPlaying]);

  // 跳转到指定时间
  const seekTo = useCallback((time: number) => {
    if (originalVideoRef.current) {
      originalVideoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  // 设置开始时间
  const handleSetStartTime = useCallback(() => {
    setStartTime(currentTime);
    logger.userAction('设置剪切开始时间', 'setStartTime', {
      startTime: currentTime,
      currentTime
    });
  }, [currentTime, logger]);

  // 设置结束时间
  const handleSetEndTime = useCallback(() => {
    setEndTime(currentTime);
    logger.userAction('设置剪切结束时间', 'setEndTime', {
      endTime: currentTime,
      currentTime
    });
  }, [currentTime, logger]);

  // 创建切片
  const handleCreateClip = useCallback(() => {
    if (startTime >= endTime) {
      showError('开始时间必须小于结束时间');
      return;
    }

    const clipDuration = endTime - startTime;
    if (clipDuration < 0.5) {
      showError('切片时长至少需要0.5秒');
      return;
    }

    const newClip: VideoClip = {
      id: `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `切片 ${clips.length + 1}`,
      startTime,
      endTime,
      duration: clipDuration,
      createdAt: new Date()
    };

    setClips(prev => [...prev, newClip]);
    
    logger.userAction('创建视频切片', 'createClip', {
      clipId: newClip.id,
      startTime,
      endTime,
      duration: clipDuration,
      totalClips: clips.length + 1
    });

    showSuccess(`已创建切片：${newClip.name}`);
    
    if (onClipCreated) {
      onClipCreated(newClip);
    }
  }, [startTime, endTime, clips.length, logger, showSuccess, showError, onClipCreated]);

  // 预览切片
  const handlePreviewClip = useCallback((clip: VideoClip) => {
    setPreviewClip(clip);
    setSelectedClipId(clip.id);
    setPreviewIsPlaying(false); // 重置播放状态
    setPreviewCurrentTime(clip.startTime); // 设置预览时间
    
    // 设置预览视频的时间范围
    if (previewVideoRef.current) {
      previewVideoRef.current.currentTime = clip.startTime;
      // 暂停预览视频
      previewVideoRef.current.pause();
    }
    
    logger.userAction('预览视频切片', 'previewClip', {
      clipId: clip.id,
      startTime: clip.startTime,
      endTime: clip.endTime
    });
  }, [logger]);

  // 删除切片
  const handleDeleteClip = useCallback((clipId: string) => {
    setClips(prev => prev.filter(clip => clip.id !== clipId));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
      setPreviewClip(null);
      setPreviewIsPlaying(false);
      setPreviewCurrentTime(0);
      // 停止预览视频播放
      if (previewVideoRef.current) {
        previewVideoRef.current.pause();
      }
    }
    
    logger.userAction('删除视频切片', 'deleteClip', {
      clipId
    });
    
    showSuccess('切片已删除');
  }, [selectedClipId, logger, showSuccess]);

  // 导出所有切片到素材管理面板
  const handleExportClips = useCallback(() => {
    if (clips.length === 0) {
      showError('没有可导出的切片');
      return;
    }

    if (!material) {
      showError('原始素材不存在');
      return;
    }

    logger.userAction('导出视频切片到素材管理', 'exportClips', {
      clipsCount: clips.length,
      clips: clips.map(clip => ({
        id: clip.id,
        name: clip.name,
        startTime: clip.startTime,
        endTime: clip.endTime,
        duration: clip.duration
      })),
      originalMaterialId: material.id,
      originalMaterialName: material.name
    });

    if (onExportClips) {
      onExportClips(clips, material);
      showSuccess(`已导出 ${clips.length} 个切片到素材管理面板`);
    } else {
      showError('导出功能不可用');
    }
  }, [clips, material, logger, showSuccess, showError, onExportClips]);

  // 格式化时间显示
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // 开始拖拽控制条
  const handleDragStart = useCallback((type: 'start' | 'end', e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(type);
    setDragStartX(e.clientX);
    setDragStartTime(type === 'start' ? startTime : endTime);
    
    logger.userAction('开始拖拽时间控制条', 'dragStart', {
      type,
      currentTime: type === 'start' ? startTime : endTime,
      mouseX: e.clientX
    });
  }, [startTime, endTime, logger]);

  // 处理拖拽移动
  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !timelineRef.current) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const timelineWidth = rect.width;
    const deltaX = e.clientX - dragStartX;
    const deltaTime = (deltaX / timelineWidth) * duration;
    const newTime = Math.max(0, Math.min(duration, dragStartTime + deltaTime));

    if (isDragging === 'start') {
      // 拖拽开始时间，不能超过结束时间
      const maxStartTime = Math.min(newTime, endTime - 0.1); // 至少保留0.1秒
      setStartTime(Math.max(0, maxStartTime));
    } else if (isDragging === 'end') {
      // 拖拽结束时间，不能小于开始时间
      const minEndTime = Math.max(newTime, startTime + 0.1); // 至少保留0.1秒
      setEndTime(Math.min(duration, minEndTime));
    }
  }, [isDragging, dragStartX, dragStartTime, duration, startTime, endTime]);

  // 结束拖拽
  const handleDragEnd = useCallback(() => {
    if (isDragging) {
      logger.userAction('结束拖拽时间控制条', 'dragEnd', {
        type: isDragging,
        finalStartTime: startTime,
        finalEndTime: endTime,
        duration: endTime - startTime
      });
    }
    setIsDragging(null);
    setDragStartX(0);
    setDragStartTime(0);
  }, [isDragging, startTime, endTime, logger]);

  // 监听拖拽事件
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
      document.body.style.cursor = 'col-resize';
      
      return () => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        document.body.style.cursor = '';
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  // 预览视频播放控制
  const handlePreviewPlayPause = useCallback(() => {
    if (!previewVideoRef.current || !previewClip) return;

    if (previewIsPlaying) {
      previewVideoRef.current.pause();
      setPreviewIsPlaying(false);
    } else {
      // 确保从切片开始时间播放
      previewVideoRef.current.currentTime = previewClip.startTime;
      previewVideoRef.current.play().then(() => {
        setPreviewIsPlaying(true);
      }).catch((error) => {
        logger.error('预览视频播放失败', error instanceof Error ? error : new Error(String(error)), {
          clipId: previewClip.id,
          startTime: previewClip.startTime,
          endTime: previewClip.endTime
        });
      });
    }
  }, [previewIsPlaying, previewClip, logger]);

  // 监听预览视频时间更新，确保在切片范围内播放
  const handlePreviewTimeUpdate = useCallback(() => {
    if (!previewVideoRef.current || !previewClip) return;

    const currentTime = previewVideoRef.current.currentTime;
    setPreviewCurrentTime(currentTime);
    
    // 如果播放超出切片结束时间，暂停并回到开始位置
    if (currentTime >= previewClip.endTime) {
      previewVideoRef.current.pause();
      previewVideoRef.current.currentTime = previewClip.startTime;
      setPreviewIsPlaying(false);
      setPreviewCurrentTime(previewClip.startTime);
    }
  }, [previewClip]);

  if (!isOpen || !material || material.type !== 'video') return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
      <div className="w-[90vw] h-[85vh] bg-white rounded-xl shadow-2xl overflow-hidden">
        {/* 标题栏 */}
        <div className="h-14 bg-gray-50 border-b border-gray-200 flex items-center justify-between px-6">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">剪切素材</h2>
              <p className="text-sm text-gray-500">{material.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 主内容区域 */}
        <div className="h-[calc(100%-3.5rem)] flex">
          {/* 左侧区域 - 原始视频预览和时间轴 */}
          <div className="w-1/2 border-r border-gray-200 flex flex-col">
            {/* 原始视频预览区域 (70%) */}
            <div className="h-[70%] bg-black relative">
              <video
                ref={originalVideoRef}
                src={material.url}
                className="w-full h-full object-contain"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              
              {/* 视频控制覆盖层 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 hover:opacity-100 transition-opacity">
                <div className="absolute bottom-4 left-4 right-4">
                  {/* 播放控制 */}
                  <div className="flex items-center space-x-4 mb-3">
                    <button
                      onClick={handlePlayPause}
                      className="w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition-colors"
                    >
                      {isPlaying ? (
                        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      )}
                    </button>
                    <span className="text-white text-sm font-medium">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>
                  
                  {/* 进度条 */}
                  <div className="relative">
                    <input
                      type="range"
                      min="0"
                      max={duration || 0}
                      value={currentTime}
                      onChange={(e) => seekTo(Number(e.target.value))}
                      className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                    />
                    {/* 标记开始和结束时间 */}
                    <div 
                      className="absolute top-0 w-1 h-1 bg-green-400 rounded-full transform -translate-y-0.5"
                      style={{ left: `${(startTime / duration) * 100}%` }}
                    />
                    <div 
                      className="absolute top-0 w-1 h-1 bg-red-400 rounded-full transform -translate-y-0.5"
                      style={{ left: `${(endTime / duration) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 时间轴切片区域 (30%) */}
            <div className="h-[30%] bg-gray-50 p-4">
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-900">时间轴控制</h3>
                  <div className="text-xs text-gray-500">
                    选择范围: {formatTime(startTime)} - {formatTime(endTime)} ({formatTime(endTime - startTime)})
                  </div>
                </div>
                
                {/* 操作提示 */}
                <div className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="text-xs text-blue-700 space-y-1">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-500 rounded"></div>
                      <span>拖拽绿色控制条调整开始时间</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-red-500 rounded"></div>
                      <span>拖拽红色控制条调整结束时间</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-blue-500 rounded"></div>
                      <span>蓝色线条表示当前播放位置</span>
                    </div>
                  </div>
                </div>
                
                {/* 时间设置按钮 */}
                <div className="flex items-center space-x-3 mb-3">
                  <button
                    onClick={handleSetStartTime}
                    className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 text-sm font-medium rounded-lg transition-colors"
                  >
                    设为开始 ({formatTime(currentTime)})
                  </button>
                  <button
                    onClick={handleSetEndTime}
                    className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-sm font-medium rounded-lg transition-colors"
                  >
                    设为结束 ({formatTime(currentTime)})
                  </button>
                  <button
                    onClick={handleCreateClip}
                    disabled={startTime >= endTime}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    创建切片
                  </button>
                </div>

                {/* 时间轴可视化 */}
                <div className="flex-1 bg-white rounded-lg border border-gray-200 p-3">
                  <div 
                    ref={timelineRef}
                    className="relative h-8 bg-gray-100 rounded cursor-pointer"
                    onClick={(e) => {
                      if (!timelineRef.current) return;
                      const rect = timelineRef.current.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      const clickTime = (clickX / rect.width) * duration;
                      seekTo(clickTime);
                    }}
                  >
                    {/* 当前播放位置 */}
                    <div 
                      className="absolute top-0 w-0.5 h-full bg-blue-500 z-30 pointer-events-none"
                      style={{ left: `${(currentTime / duration) * 100}%` }}
                    />
                    
                    {/* 选中范围背景 */}
                    <div 
                      className="absolute top-0 h-full bg-blue-200 opacity-60 rounded"
                      style={{ 
                        left: `${(startTime / duration) * 100}%`,
                        width: `${((endTime - startTime) / duration) * 100}%`
                      }}
                    />
                    
                    {/* 开始时间控制条 */}
                    <div 
                      className={`absolute top-0 w-3 h-full bg-green-500 rounded-l cursor-col-resize z-20 flex items-center justify-center hover:bg-green-600 transition-colors ${
                        isDragging === 'start' ? 'bg-green-600 shadow-lg' : ''
                      }`}
                      style={{ left: `${(startTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
                      onMouseDown={(e) => handleDragStart('start', e)}
                      title={`开始时间: ${formatTime(startTime)}`}
                    >
                      <div className="w-1 h-4 bg-white rounded opacity-80"></div>
                    </div>
                    
                    {/* 结束时间控制条 */}
                    <div 
                      className={`absolute top-0 w-3 h-full bg-red-500 rounded-r cursor-col-resize z-20 flex items-center justify-center hover:bg-red-600 transition-colors ${
                        isDragging === 'end' ? 'bg-red-600 shadow-lg' : ''
                      }`}
                      style={{ left: `${(endTime / duration) * 100}%`, transform: 'translateX(-50%)' }}
                      onMouseDown={(e) => handleDragStart('end', e)}
                      title={`结束时间: ${formatTime(endTime)}`}
                    >
                      <div className="w-1 h-4 bg-white rounded opacity-80"></div>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>0:00</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右侧区域 - 剪切后视频预览和切片列表 */}
          <div className="w-1/2 flex flex-col">
            {/* 剪切后视频预览区域 (50%) */}
            <div className="h-[50%] bg-black relative">
              {previewClip ? (
                <>
                  <video
                    ref={previewVideoRef}
                    src={material.url}
                    className="w-full h-full object-contain"
                    onTimeUpdate={handlePreviewTimeUpdate}
                    onPlay={() => setPreviewIsPlaying(true)}
                    onPause={() => setPreviewIsPlaying(false)}
                    onEnded={() => {
                      setPreviewIsPlaying(false);
                      // 回到切片开始位置
                      if (previewVideoRef.current && previewClip) {
                        previewVideoRef.current.currentTime = previewClip.startTime;
                      }
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-4 left-4 right-4">
                      <div className="flex items-center space-x-4">
                        <button
                          onClick={handlePreviewPlayPause}
                          className="w-10 h-10 bg-white/20 hover:bg-white/30 rounded-full flex items-center justify-center transition-colors"
                        >
                          {previewIsPlaying ? (
                            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                            </svg>
                          ) : (
                            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white text-sm font-medium">
                              预览: {previewClip.name}
                            </span>
                            <span className="text-white text-xs">
                              {formatTime(Math.max(0, previewCurrentTime - previewClip.startTime))} / {formatTime(previewClip.duration)}
                            </span>
                          </div>
                          {/* 切片播放进度条 */}
                          <div className="relative">
                            <div className="w-full h-1 bg-white/20 rounded-lg">
                              <div 
                                className="h-full bg-white rounded-lg transition-all duration-100"
                                style={{ 
                                  width: `${Math.max(0, Math.min(100, ((previewCurrentTime - previewClip.startTime) / previewClip.duration) * 100))}%`
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center text-gray-400">
                    <svg className="w-16 h-16 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">选择切片进行预览</p>
                  </div>
                </div>
              )}
            </div>

            {/* 切片列表区域 (50%) */}
            <div className="h-[50%] bg-gray-50 p-4">
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-900">切片列表</h3>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-gray-500">{clips.length} 个切片</span>
                    <button
                      onClick={handleExportClips}
                      disabled={clips.length === 0}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        clips.length === 0
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                      title={clips.length === 0 ? '没有可导出的切片' : `导出 ${clips.length} 个切片到素材管理面板`}
                    >
                      <div className="flex items-center space-x-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>导出切片</span>
                      </div>
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                  {clips.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center text-gray-400">
                        <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-sm">还没有创建任何切片</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {clips.map((clip) => (
                        <div
                          key={clip.id}
                          className={`p-3 bg-white rounded-lg border transition-all cursor-pointer ${
                            selectedClipId === clip.id 
                              ? 'border-blue-500 shadow-sm' 
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                          onClick={() => handlePreviewClip(clip)}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-gray-900">{clip.name}</h4>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClip(clip.id);
                              }}
                              className="w-6 h-6 text-gray-400 hover:text-red-500 rounded transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{formatTime(clip.startTime)} - {formatTime(clip.endTime)}</span>
                            <span>{formatTime(clip.duration)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoCutModal; 