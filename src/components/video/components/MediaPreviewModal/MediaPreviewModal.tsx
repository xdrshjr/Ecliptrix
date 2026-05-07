'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MaterialItem } from '@/types';
import { VideoEditingLogger } from '../../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';

interface MediaPreviewModalProps {
  isOpen: boolean;
  material: MaterialItem | null;
  onClose: () => void;
  taskId: string;
}

const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  isOpen,
  material,
  onClose,
  taskId
}) => {
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  const logger = new VideoEditingLogger({
    taskId,
    component: 'MediaPreviewModal'
  });
  
  const { showSuccess } = useNotification();
  const { t } = useLocale();

  // 重置状态当弹窗打开时
  useEffect(() => {
    if (isOpen && material) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setIsDragging(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      
      logger.info('媒体预览弹窗打开', {
        materialId: material.id,
        materialName: material.name,
        materialType: material.type,
        materialUrl: material.url.substring(0, 100),
        zIndex: 200,
        modalLayer: '预览弹窗已设置为最高层级，应覆盖taskbar'
      });
    }
  }, [isOpen, material?.id]); // 只依赖 isOpen 和 material.id

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        logger.info('按ESC键关闭预览弹窗', {
          materialId: material?.id,
          materialName: material?.name,
          closeMethod: 'escape-key'
        });
        onClose();
      } else if (material?.type === 'image') {
        if (e.key === '+' || e.key === '=') {
          handleZoomIn();
        } else if (e.key === '-') {
          handleZoomOut();
        } else if (e.key === '0') {
          handleResetZoom();
        }
      } else if (material?.type === 'video' || material?.type === 'audio') {
        if (e.key === ' ') {
          e.preventDefault();
          handlePlayPause();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, material]);

  // 图片缩放功能
  const handleZoomIn = useCallback(() => {
    setScale(prev => {
      const newScale = Math.min(prev * 1.2, 5);
      logger.info('图片缩放放大', { newScale });
      return newScale;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => {
      const newScale = Math.max(prev / 1.2, 0.1);
      logger.info('图片缩放缩小', { newScale });
      return newScale;
    });
  }, []);

  const handleResetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    logger.info('重置图片缩放和位置');
  }, []);

  // 图片拖拽功能
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (material?.type !== 'image' || scale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [material?.type, scale, position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 图片容器引用
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // 处理滚轮缩放
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container || material?.type !== 'image') return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setScale(prev => Math.max(0.1, Math.min(5, prev * delta)));
    };

    // 添加非被动事件监听器
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [material?.type]);

  // 视频/音频播放控制
  const handlePlayPause = useCallback(() => {
    const mediaElement = material?.type === 'video' ? videoRef.current : audioRef.current;
    if (!mediaElement) return;

    if (isPlaying) {
      mediaElement.pause();
      setIsPlaying(false);
      logger.info('暂停播放', { materialType: material?.type });
    } else {
      mediaElement.play();
      setIsPlaying(true);
      logger.info('开始播放', { materialType: material?.type });
    }
  }, [isPlaying, material?.type]);

  const handleSeek = useCallback((time: number) => {
    const mediaElement = material?.type === 'video' ? videoRef.current : audioRef.current;
    if (!mediaElement) return;
    
    mediaElement.currentTime = time;
    setCurrentTime(time);
    logger.info('跳转播放位置', { time, materialType: material?.type });
  }, [material?.type]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    const mediaElement = material?.type === 'video' ? videoRef.current : audioRef.current;
    if (!mediaElement) return;
    
    mediaElement.volume = newVolume;
    setVolume(newVolume);
    logger.info('调整音量', { volume: newVolume, materialType: material?.type });
  }, [material?.type]);

  // 媒体事件处理
  const handleLoadedMetadata = useCallback(() => {
    const mediaElement = material?.type === 'video' ? videoRef.current : audioRef.current;
    if (!mediaElement) return;
    
    setDuration(mediaElement.duration);
    logger.info('媒体元数据加载完成', { 
      duration: mediaElement.duration, 
      materialType: material?.type 
    });
  }, [material?.type]);

  const handleTimeUpdate = useCallback(() => {
    const mediaElement = material?.type === 'video' ? videoRef.current : audioRef.current;
    if (!mediaElement) return;
    
    setCurrentTime(mediaElement.currentTime);
  }, [material?.type]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    logger.info('播放结束', { materialType: material?.type });
  }, [material?.type]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      logger.info('点击背景关闭预览弹窗', {
        materialId: material?.id,
        materialName: material?.name,
        closeMethod: 'backdrop-click'
      });
      onClose();
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!isOpen || !material) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-modal"
      onClick={handleBackdropClick}
    >
      {/* 工具栏 */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-4 bg-black bg-opacity-60 rounded-md px-4 py-2 z-10">
        <span className="text-white text-sm font-medium">{material.name}</span>
        
        {/* 图片缩放控制 */}
        {material.type === 'image' && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleZoomOut}
              className="p-2 text-white hover:bg-accent rounded-md transition-colors"
              title={t.mediaPreview.zoomOut}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <span className="text-white text-sm min-w-16 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-2 text-white hover:bg-accent rounded-md transition-colors"
              title={t.mediaPreview.zoomIn}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              onClick={handleResetZoom}
              className="p-2 text-white hover:bg-accent rounded-md transition-colors"
              title={t.mediaPreview.reset}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        )}

        {/* 播放控制 */}
        {(material.type === 'video' || material.type === 'audio') && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePlayPause}
              className="p-2 text-white hover:bg-accent rounded-md transition-colors"
              title={isPlaying ? t.mediaPreview.pause : t.mediaPreview.play}
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>
            
            <span className="text-white text-sm">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            
            {/* 音量控制 */}
            <div className="flex items-center space-x-1">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-16 h-1 bg-border rounded-md appearance-none cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="p-2 text-white hover:bg-accent rounded-md transition-colors"
          title={t.mediaPreview.close}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 媒体内容 */}
      <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
        {material.type === 'image' && (
          <div 
            ref={imageContainerRef}
            className="relative w-full h-full overflow-hidden cursor-move select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
          >
            <img
              src={material.url}
              alt={material.name}
              className="absolute top-1/2 left-1/2 max-w-none pointer-events-none"
              style={{
                transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out'
              }}
              draggable={false}
            />
          </div>
        )}

        {material.type === 'video' && (
          <div className="relative max-w-full max-h-full">
            <video
              ref={videoRef}
              src={material.url}
              className="max-w-full max-h-full"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              controls={false}
              preload="metadata"
            />
            
            {/* 进度条 */}
            <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 rounded-md p-2">
              <input
                type="range"
                min="0"
                max={duration}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full h-2 bg-border rounded-md appearance-none cursor-pointer"
              />
            </div>
          </div>
        )}

        {material.type === 'audio' && (
          <div className="flex flex-col items-center space-y-6 bg-black bg-opacity-50 rounded-md p-8">
            <audio
              ref={audioRef}
              src={material.url}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
            />
            
            {/* 音频图标 */}
            <div className="w-32 h-32 bg-card bg-opacity-10 rounded-full flex items-center justify-center">
              <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M9 9a3 3 0 000 6 3 3 0 000-6z" />
              </svg>
            </div>
            
            {/* 音频信息 */}
            <div className="text-center text-white">
              <h3 className="text-lg font-medium mb-2">{material.name}</h3>
              <p className="text-sm opacity-80">
                {formatTime(currentTime)} / {formatTime(duration)}
              </p>
            </div>
            
            {/* 进度条 */}
            <div className="w-80 bg-black bg-opacity-50 rounded-md p-2">
              <input
                type="range"
                min="0"
                max={duration}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="w-full h-2 bg-border rounded-md appearance-none cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* 快捷键提示 */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-60 rounded-md px-4 py-2">
        <div className="text-white text-xs text-center space-y-1">
          {material.type === 'image' && (
            <>
              <div>{t.mediaPreview.imageShortcutsLine1}</div>
              <div>{t.mediaPreview.imageShortcutsLine2}</div>
            </>
          )}
          {(material.type === 'video' || material.type === 'audio') && (
            <div>{t.mediaPreview.mediaShortcutsLine}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MediaPreviewModal; 