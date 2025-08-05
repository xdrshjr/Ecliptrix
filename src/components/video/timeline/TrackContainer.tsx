'use client';

import React from 'react';
import { Track as TrackType, TimelineState } from '@/types';
import Track from './Track';

interface TrackContainerProps {
  timelineState: TimelineState;
  onSelectItem: (itemId: string, isMultiSelect?: boolean) => void;
  onMoveItem: (itemId: string, newStartTime: number) => void;
  onResizeItem: (itemId: string, newDuration: number, resizeType: 'start' | 'end') => void;
  onToggleTrackMute: (trackId: string) => void;
  onToggleTrackLock: (trackId: string) => void;
  onToggleTrackVisibility: (trackId: string) => void;
  onAddTrack: (type: 'video' | 'audio' | 'subtitle') => void;
  onRemoveTrack: (trackId: string) => void;
  onReorderTracks: (sourceIndex: number, destinationIndex: number) => void;
}

const TrackContainer: React.FC<TrackContainerProps> = ({
  timelineState,
  onSelectItem,
  onMoveItem,
  onResizeItem,
  onToggleTrackMute,
  onToggleTrackLock,
  onToggleTrackVisibility,
  onAddTrack,
  onRemoveTrack,
  onReorderTracks
}) => {
  const { tracks, selectedItems, totalDuration, zoomLevel } = timelineState;
  const pixelsPerSecond = zoomLevel * 50; // 基础像素比例

  console.log(`[TrackContainer] 渲染轨道容器`, {
    trackCount: tracks.length,
    selectedItemsCount: selectedItems.length,
    totalDuration: totalDuration.toFixed(2),
    zoomLevel: zoomLevel.toFixed(2),
    pixelsPerSecond: pixelsPerSecond.toFixed(2),
    timestamp: new Date().toISOString()
  });

  // 按顺序排序轨道
  const sortedTracks = [...tracks].sort((a, b) => a.order - b.order);

  // 处理轨道背景点击（取消选择）
  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      console.log(`[TrackContainer] 点击空白区域，取消所有选择`, {
        previousSelectedCount: selectedItems.length,
        timestamp: new Date().toISOString()
      });
      onSelectItem('', false); // 传递空字符串表示取消所有选择
    }
  };

  // 处理添加轨道
  const handleAddTrack = (type: 'video' | 'audio' | 'subtitle') => {
    console.log(`[TrackContainer] 添加新轨道`, {
      trackType: type,
      currentTrackCount: tracks.length,
      timestamp: new Date().toISOString()
    });
    onAddTrack(type);
  };

  return (
    <div className="track-container flex-1 flex flex-col overflow-hidden bg-gray-50">
      {/* 轨道列表 */}
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onClick={handleContainerClick}
      >
        {sortedTracks.length > 0 ? (
          sortedTracks.map((track) => (
            <Track
              key={track.id}
              track={track}
              pixelsPerSecond={pixelsPerSecond}
              selectedItems={selectedItems}
              onSelectItem={onSelectItem}
              onMoveItem={onMoveItem}
              onResizeItem={onResizeItem}
              onToggleMute={onToggleTrackMute}
              onToggleLock={onToggleTrackLock}
              onToggleVisibility={onToggleTrackVisibility}
              totalDuration={totalDuration}
            />
          ))
        ) : (
          /* 空状态显示 */
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">暂无轨道</h3>
              <p className="text-gray-500 mb-6 max-w-sm">
                开始创建您的第一个轨道，添加视频、音频或字幕素材
              </p>
              <div className="flex items-center justify-center space-x-3">
                <button
                  onClick={() => handleAddTrack('video')}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
                  </svg>
                  <span>视频轨道</span>
                </button>
                <button
                  onClick={() => handleAddTrack('audio')}
                  className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                  </svg>
                  <span>音频轨道</span>
                </button>
                <button
                  onClick={() => handleAddTrack('subtitle')}
                  className="flex items-center space-x-2 px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                  </svg>
                  <span>字幕轨道</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部轨道管理栏 */}
      <div className="flex-shrink-0 h-10 bg-gray-100 border-t border-gray-200 flex items-center justify-between px-4">
        {/* 左侧轨道信息 */}
        <div className="flex items-center space-x-4 text-sm text-gray-600">
          <span>轨道: {tracks.length}</span>
          <span>素材: {tracks.reduce((total, track) => total + track.items.length, 0)}</span>
          <span>时长: {Math.floor(totalDuration / 60)}:{(totalDuration % 60).toFixed(0).padStart(2, '0')}</span>
        </div>

        {/* 右侧添加轨道按钮 */}
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">添加轨道:</span>
          
          <div className="flex items-center space-x-1">
            <button
              onClick={() => handleAddTrack('video')}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors group"
              title="添加视频轨道"
            >
              <svg className="w-4 h-4 text-blue-600 group-hover:text-blue-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            </button>
            
            <button
              onClick={() => handleAddTrack('audio')}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors group"
              title="添加音频轨道"
            >
              <svg className="w-4 h-4 text-green-600 group-hover:text-green-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </button>
            
            <button
              onClick={() => handleAddTrack('subtitle')}
              className="p-1.5 rounded hover:bg-gray-200 transition-colors group"
              title="添加字幕轨道"
            >
              <svg className="w-4 h-4 text-amber-600 group-hover:text-amber-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackContainer; 