'use client';

import React from 'react';
import { Track as TrackType, TimelineItem as TimelineItemType } from '@/types';
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
  totalDuration: number;
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
  totalDuration
}) => {
  console.log(`[Track] 渲染轨道`, {
    trackId: track.id,
    trackName: track.name,
    trackType: track.type,
    itemCount: track.items.length,
    isLocked: track.isLocked,
    isMuted: track.isMuted,
    isVisible: track.isVisible,
    timestamp: new Date().toISOString()
  });

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
    <div 
      className="timeline-track flex border-b border-gray-200"
      style={{ height: `${track.height}px` }}
    >
      {/* 轨道标签区域 */}
      <div className="track-label flex-shrink-0 w-48 bg-gray-50 border-r border-gray-200 flex items-center justify-between px-3 py-2">
        <div className="flex items-center space-x-2 min-w-0">
          <div className={`${getTrackColor()} flex-shrink-0`}>
            {getTrackIcon()}
          </div>
          <span className="text-sm font-medium text-gray-900 truncate">
            {track.name}
          </span>
        </div>
        
        {/* 轨道控制按钮 */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          {/* 可见性切换 */}
          <button
            onClick={handleVisibilityClick}
            className={`p-1 rounded transition-colors ${
              track.isVisible 
                ? 'text-gray-600 hover:text-gray-800 hover:bg-gray-200' 
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
            }`}
            title={track.isVisible ? '隐藏轨道' : '显示轨道'}
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              {track.isVisible ? (
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              ) : (
                <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
              )}
            </svg>
          </button>

          {/* 静音切换（仅音频轨道） */}
          {track.type === 'audio' && (
            <button
              onClick={handleMuteClick}
              className={`p-1 rounded transition-colors ${
                track.isMuted 
                  ? 'text-red-500 hover:text-red-700 hover:bg-red-50' 
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200'
              }`}
              title={track.isMuted ? '取消静音' : '静音'}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                {track.isMuted ? (
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                ) : (
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                )}
              </svg>
            </button>
          )}

          {/* 锁定切换 */}
          <button
            onClick={handleLockClick}
            className={`p-1 rounded transition-colors ${
              track.isLocked 
                ? 'text-red-500 hover:text-red-700 hover:bg-red-50' 
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200'
            }`}
            title={track.isLocked ? '解锁轨道' : '锁定轨道'}
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              {track.isLocked ? (
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
              ) : (
                <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* 轨道内容区域 */}
      <div 
        className="track-content flex-1 relative bg-white"
        style={{ 
          opacity: track.isVisible ? 1 : 0.3,
          pointerEvents: track.isLocked ? 'none' : 'auto'
        }}
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
            trackHeight={track.height}
          />
        ))}

        {/* 拖拽放置区域提示 */}
        {track.items.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4">
                {getTrackIcon()}
              </div>
              <span>拖拽{track.type === 'video' ? '视频' : track.type === 'audio' ? '音频' : '字幕'}素材到此轨道</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Track; 