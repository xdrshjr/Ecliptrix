'use client';

import React, { RefObject } from 'react';
import { Track as TrackType, TimelineState, MaterialItem } from '@/types';
import { SupportedLocale } from '@/lib/i18n';
import { useLocale } from '@/contexts/LocaleContext';
import Track from './Track';

interface TrackContainerProps {
  timelineState: TimelineState;
  onSelectItem: (itemId: string, isMultiSelect?: boolean) => void;
  onMoveItem: (itemId: string, newStartTime: number) => void;
  onResizeItem: (itemId: string, newDuration: number, resizeType: 'start' | 'end') => void;
  onSubtitleEdit?: (itemId: string, newText: string) => void;
  onEditSubtitles?: (trackId: string) => void;
  onToggleTrackMute: (trackId: string) => void;
  onToggleTrackLock: (trackId: string) => void;
  onToggleTrackVisibility: (trackId: string) => void;
  onTrackVolumeChange: (trackId: string, volume: number) => void;
  onSelectAllTrackItems: (trackId: string) => void;
  onAddTrack: (type: 'video' | 'audio' | 'subtitle') => void;
  onRemoveTrack: (trackId: string) => void;
  onReorderTracks: (sourceIndex: number, destinationIndex: number) => void;
  onMaterialDrop?: (material: MaterialItem, trackId: string) => void;
  locale?: SupportedLocale; // 保持向后兼容性，但context优先
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (scrollLeft: number) => void;
  scrollLeft?: number;
}

const TrackContainer: React.FC<TrackContainerProps> = ({
  timelineState,
  onSelectItem,
  onMoveItem,
  onResizeItem,
  onSubtitleEdit,
  onEditSubtitles,
  onToggleTrackMute,
  onToggleTrackLock,
  onToggleTrackVisibility,
  onTrackVolumeChange,
  onSelectAllTrackItems,
  onAddTrack,
  onRemoveTrack,
  onReorderTracks,
  onMaterialDrop,
  locale, // 保持向后兼容性，但不再使用
  scrollRef,
  onScroll,
  scrollLeft = 0
}) => {
  // 使用LocaleContext获取国际化翻译
  const { t, locale: contextLocale } = useLocale();
  const { tracks, selectedItems, totalDuration, zoomLevel } = timelineState;
  const pixelsPerSecond = zoomLevel * 50; // 基础像素比例

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
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-auto"
        onClick={handleContainerClick}
        onScroll={(e) => {
          if (onScroll) {
            onScroll(e.currentTarget.scrollLeft);
          }
        }}
      >
        {/* 滚动内容容器 */}
        <div 
          className="relative"
          style={{ 
            minWidth: `${Math.max(totalDuration * pixelsPerSecond, 800)}px`
          }}
        >
          {sortedTracks.length > 0 ? (
            sortedTracks.map((track) => (
              <Track
                key={track.id}
                track={track}
                pixelsPerSecond={pixelsPerSecond}
                selectedItems={timelineState.selectedItems}
                onSelectItem={onSelectItem}
                onMoveItem={onMoveItem}
                onResizeItem={onResizeItem}
                onSubtitleEdit={onSubtitleEdit}
                onEditSubtitles={onEditSubtitles}
                onToggleMute={onToggleTrackMute}
                onToggleLock={onToggleTrackLock}
                onToggleVisibility={onToggleTrackVisibility}
                onVolumeChange={onTrackVolumeChange}
                onSelectAllItems={onSelectAllTrackItems}
                onMaterialDrop={onMaterialDrop}
                totalDuration={totalDuration}
                locale={contextLocale} // 传递context中的locale
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
      </div>

      {/* 底部轨道管理栏 - 高度与时间刻度轴一致 */}
      <div className="flex-shrink-0 h-8 bg-gray-100 border-t border-gray-200 flex items-center justify-between px-4">
        {/* 左侧轨道信息 */}
        <div className="flex items-center space-x-3 text-xs text-gray-600">
          <span>{t.timeline.trackBar.tracks}: {tracks.length}</span>
          <span>{t.timeline.trackBar.materials}: {tracks.reduce((total, track) => total + track.items.length, 0)}</span>
          <span>{t.timeline.trackBar.duration}: {Math.floor(totalDuration / 60)}:{(totalDuration % 60).toFixed(0).padStart(2, '0')}</span>
        </div>

        {/* 右侧添加轨道按钮 */}
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-600">{t.timeline.trackBar.addTrack}:</span>
          
          <div className="flex items-center space-x-1">
            {/* 视频轨道按钮 */}
            <div className="relative group">
              <button
                onClick={() => {
                  console.log(`[TrackContainer] 添加视频轨道`, {
                    timestamp: new Date().toISOString()
                  });
                  handleAddTrack('video');
                }}
                className="p-1.5 rounded hover:bg-gray-200 transition-colors w-6 h-6 flex items-center justify-center"
                aria-label={t.timeline.trackBar.addVideoTrack}
              >
                <svg className="w-3 h-3 text-blue-600 group-hover:text-blue-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
                </svg>
                
                {/* 悬停提示 */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded-md shadow-xl whitespace-nowrap border border-gray-600">
                    {t.timeline.trackBar.addVideoTrack}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
            
            {/* 音频轨道按钮 */}
            <div className="relative group">
              <button
                onClick={() => {
                  console.log(`[TrackContainer] 添加音频轨道`, {
                    timestamp: new Date().toISOString()
                  });
                  handleAddTrack('audio');
                }}
                className="p-1.5 rounded hover:bg-gray-200 transition-colors w-6 h-6 flex items-center justify-center"
                aria-label={t.timeline.trackBar.addAudioTrack}
              >
                <svg className="w-3 h-3 text-green-600 group-hover:text-green-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                
                {/* 悬停提示 */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded-md shadow-xl whitespace-nowrap border border-gray-600">
                    {t.timeline.trackBar.addAudioTrack}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
            
            {/* 字幕轨道按钮 */}
            <div className="relative group">
              <button
                onClick={() => {
                  console.log(`[TrackContainer] 添加字幕轨道`, {
                    timestamp: new Date().toISOString()
                  });
                  handleAddTrack('subtitle');
                }}
                className="p-1.5 rounded hover:bg-gray-200 transition-colors w-6 h-6 flex items-center justify-center"
                aria-label={t.timeline.trackBar.addSubtitleTrack}
              >
                <svg className="w-3 h-3 text-amber-600 group-hover:text-amber-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                </svg>
                
                {/* 悬停提示 */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded-md shadow-xl whitespace-nowrap border border-gray-600">
                    {t.timeline.trackBar.addSubtitleTrack}
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
    </div>
  );
};

export default TrackContainer; 