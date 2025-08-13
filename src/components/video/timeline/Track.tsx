'use client';

import React, { useState } from 'react';
import { Track as TrackType, TimelineItem as TimelineItemType, MaterialItem } from '@/types';
import { getTranslations, defaultLocale, type SupportedLocale } from '@/lib/i18n';
import TimelineItem from './TimelineItem';

interface TrackProps {
  track: TrackType;
  pixelsPerSecond: number;
  selectedItems: string[];
  onSelectItem: (itemId: string, isMultiSelect?: boolean) => void;
  onMoveItem: (itemId: string, newStartTime: number) => void;
  onResizeItem: (itemId: string, newDuration: number, resizeType: 'start' | 'end') => void;
  onToggleMute: (trackId: string) => void;
  onToggleLock: (trackId: string) => void;
  onToggleVisibility: (trackId: string) => void;
  onMaterialDrop?: (material: MaterialItem, trackId: string) => void;
  totalDuration: number;
  locale?: SupportedLocale;
}

const Track: React.FC<TrackProps> = ({
  track,
  pixelsPerSecond,
  selectedItems,
  onSelectItem,
  onMoveItem,
  onResizeItem,
  onToggleMute,
  onToggleLock,
  onToggleVisibility,
  onMaterialDrop,
  totalDuration,
  locale = defaultLocale
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  
  // 获取国际化翻译
  const t = getTranslations(locale);

  // 检查素材类型是否与轨道兼容
  const isMaterialCompatible = (materialType: string): boolean => {
    switch (materialType) {
      case 'video':
      case 'image':
        return track.type === 'video';
      case 'audio':
        return track.type === 'audio';
      case 'subtitle':
        return track.type === 'subtitle';
      default:
        return false;
    }
  };

  // 拖拽进入处理
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (track.isLocked) return;

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const dragData = JSON.parse(data);
        if (dragData.type === 'material' && isMaterialCompatible(dragData.material?.type)) {
          setIsDragOver(true);
          console.log(`[Track] 素材拖拽进入兼容轨道`, {
            trackId: track.id,
            trackType: track.type,
            materialType: dragData.material?.type,
            materialName: dragData.material?.name
          });
        }
      }
    } catch (error) {
      // 忽略解析错误，可能是其他类型的拖拽
    }
  };

  // 拖拽悬停处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (track.isLocked) return;
    
    e.dataTransfer.dropEffect = 'copy';
  };

  // 拖拽离开处理
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  // 拖拽放置处理
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (track.isLocked) {
      console.warn(`[Track] 轨道已锁定，无法放置素材`, { trackId: track.id });
      return;
    }

    try {
      const data = e.dataTransfer.getData('application/json');
      if (!data) return;

      const dragData = JSON.parse(data);
      if (dragData.type === 'material' && dragData.material) {
        const material = dragData.material as MaterialItem;
        
        if (!isMaterialCompatible(material.type)) {
          console.warn(`[Track] 素材类型不兼容`, {
            trackId: track.id,
            trackType: track.type,
            materialType: material.type
          });
          return;
        }

        console.log(`[Track] 处理素材放置到轨道`, {
          trackId: track.id,
          materialId: material.id,
          materialName: material.name,
          materialType: material.type
        });

        if (onMaterialDrop) {
          onMaterialDrop(material, track.id);
        }
      }
    } catch (error) {
      console.error('[Track] 拖拽数据解析失败:', error);
    }
  };

  // 获取轨道类型对应的图标
  const getTrackIcon = () => {
    switch (track.type) {
      case 'video':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        );
      case 'audio':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        );
      case 'subtitle':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
          </svg>
        );
      default:
        return null;
    }
  };

  // 获取轨道类型对应的颜色
  const getTrackColor = () => {
    switch (track.type) {
      case 'video':
        return 'text-blue-600';
      case 'audio':
        return 'text-green-600';
      case 'subtitle':
        return 'text-amber-600';
      default:
        return 'text-gray-600';
    }
  };

  // 处理轨道控制按钮点击
  const handleMuteClick = () => {
    console.log(`[Track] 切换轨道静音状态`, {
      trackId: track.id,
      currentMuted: track.isMuted,
      newMuted: !track.isMuted,
      timestamp: new Date().toISOString()
    });
    onToggleMute(track.id);
  };

  const handleLockClick = () => {
    console.log(`[Track] 切换轨道锁定状态`, {
      trackId: track.id,
      currentLocked: track.isLocked,
      newLocked: !track.isLocked,
      timestamp: new Date().toISOString()
    });
    onToggleLock(track.id);
  };

  const handleVisibilityClick = () => {
    console.log(`[Track] 切换轨道可见性`, {
      trackId: track.id,
      currentVisible: track.isVisible,
      newVisible: !track.isVisible,
      timestamp: new Date().toISOString()
    });
    onToggleVisibility(track.id);
  };

  return (
    <div className="track flex border-b border-gray-100 last:border-b-0">
      {/* 轨道控制区域 - 紧凑设计 */}
      <div className="track-controls w-48 bg-gray-50 border-r border-gray-200">
        {/* 轨道标题和控制按钮在同一行 */}
        <div className="flex items-center justify-between p-2 h-8">
          {/* 左侧：图标和标题 */}
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <div className={`${getTrackColor()}`}>
              {getTrackIcon()}
            </div>
            <span className="text-xs font-medium text-gray-900 truncate" title={track.name}>
              {track.name}
            </span>
          </div>
          
          {/* 右侧：控制按钮 */}
          <div className="flex items-center space-x-1">
            {/* 静音按钮（仅音频轨道） */}
            {track.type === 'audio' && (
              <div className="relative group">
                <button
                  onClick={handleMuteClick}
                  className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                    track.isMuted 
                      ? 'bg-red-100 text-red-600 hover:bg-red-200' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  aria-label={track.isMuted ? t.timeline.track.unmute : t.timeline.track.mute}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    {track.isMuted ? (
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                    ) : (
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    )}
                  </svg>
                  
                  {/* 悬停提示 */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                    <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded-md shadow-xl whitespace-nowrap border border-gray-600">
                      {track.isMuted ? t.timeline.track.unmute : t.timeline.track.mute}
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                        <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* 锁定按钮 */}
            <div className="relative group">
              <button
                onClick={handleLockClick}
                className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                  track.isLocked 
                    ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                aria-label={track.isLocked ? t.timeline.track.unlock : t.timeline.track.lock}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  {track.isLocked ? (
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/>
                  ) : (
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/>
                  )}
                </svg>
                
                {/* 悬停提示 */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded-md shadow-xl whitespace-nowrap border border-gray-600">
                    {track.isLocked ? t.timeline.track.unlock : t.timeline.track.lock}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* 可见性按钮 */}
            <div className="relative group">
              <button
                onClick={handleVisibilityClick}
                className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                  track.isVisible 
                    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' 
                    : 'bg-gray-300 text-gray-500 hover:bg-gray-400'
                }`}
                aria-label={track.isVisible ? t.timeline.track.hide : t.timeline.track.show}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  {track.isVisible ? (
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                  ) : (
                    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                  )}
                </svg>
                
                {/* 悬停提示 */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded-md shadow-xl whitespace-nowrap border border-gray-600">
                    {track.isVisible ? t.timeline.track.hide : t.timeline.track.show}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 轨道内容区域 - 高度与标题栏一致 */}
      <div 
        className={`track-content flex-1 relative ${
          isDragOver ? 'bg-blue-50 border-2 border-blue-300 border-dashed' : 'bg-white'
        }`}
        style={{ 
          opacity: track.isVisible ? 1 : 0.3,
          pointerEvents: track.isLocked ? 'none' : 'auto',
          height: '32px'  // 固定高度为32px，与标题栏一致
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 背景网格线 */}
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(Math.ceil(totalDuration))].map((_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 border-l border-gray-100"
              style={{ left: `${i * pixelsPerSecond}px` }}
            />
          ))}
        </div>

        {/* 渲染轨道上的所有项目 */}
        {track.items.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            pixelsPerSecond={pixelsPerSecond}
            onSelect={onSelectItem}
            onMove={onMoveItem}
            onResize={onResizeItem}
            isSelected={selectedItems.includes(item.id)}
            trackHeight={32} // 使用固定的32px高度，与轨道内容区域一致
          />
        ))}

        {/* 拖拽放置区域提示 */}
        {track.items.length === 0 && (
          <div className={`absolute inset-0 flex items-center justify-center text-gray-400 text-xs pointer-events-none ${
            isDragOver ? 'text-blue-600' : ''
          }`}>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3">
                {getTrackIcon()}
              </div>
              <span>
                {isDragOver 
                  ? (track.type === 'video' ? t.timeline.track.dropVideoHere :
                     track.type === 'audio' ? t.timeline.track.dropAudioHere :
                     t.timeline.track.dropSubtitleHere)
                  : (track.type === 'video' ? t.timeline.track.dropVideoHere :
                     track.type === 'audio' ? t.timeline.track.dropAudioHere :
                     t.timeline.track.dropSubtitleHere)
                }
              </span>
            </div>
          </div>
        )}

        {/* 拖拽悬停提示 */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-50 bg-opacity-90 pointer-events-none">
            <div className="bg-blue-600 text-white px-2 py-1 rounded shadow-lg">
              <div className="flex items-center space-x-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span className="text-xs">{t.timeline.track.dropToTrack.replace('{trackName}', track.name)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Track; 