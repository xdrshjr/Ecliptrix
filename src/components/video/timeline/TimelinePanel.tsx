'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { TimelineState, TimelineToolType, Track, TimelineItem, TimelineAction } from '@/types';
import TimelineToolbar from './TimelineToolbar';
import TimelineRuler from './TimelineRuler';
import TrackContainer from './TrackContainer';

interface TimelinePanelProps {
  className?: string;
}

const TimelinePanel: React.FC<TimelinePanelProps> = ({ className = '' }) => {
  // 创建丰富的Mock数据
  const createMockTimelineState = (): TimelineState => {
    const mockTracks: Track[] = [
      {
        id: 'video-track-1',
        name: '视频轨道 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 0,
        items: [
          {
            id: 'video-item-1',
            name: '开场介绍.mp4',
            type: 'video',
            startTime: 0,
            duration: 5.5,
            trackId: 'video-track-1',
            color: '#3b82f6',
            thumbnailUrl: 'https://via.placeholder.com/120x68/3b82f6/ffffff?text=Video',
            materialId: 'material-1',
            volume: 1.0,
            opacity: 1.0
          },
          {
            id: 'video-item-2',
            name: '主要内容.mp4',
            type: 'video',
            startTime: 6,
            duration: 12.3,
            trackId: 'video-track-1',
            color: '#2563eb',
            thumbnailUrl: 'https://via.placeholder.com/120x68/2563eb/ffffff?text=Main',
            materialId: 'material-2',
            volume: 1.0,
            opacity: 1.0
          },
          {
            id: 'video-item-3',
            name: '结尾总结.mp4',
            type: 'video',
            startTime: 19,
            duration: 4.2,
            trackId: 'video-track-1',
            color: '#1d4ed8',
            thumbnailUrl: 'https://via.placeholder.com/120x68/1d4ed8/ffffff?text=End',
            materialId: 'material-3',
            volume: 1.0,
            opacity: 1.0
          }
        ]
      },
      {
        id: 'video-track-2',
        name: '视频轨道 2',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 1,
        items: [
          {
            id: 'video-item-4',
            name: '画中画.mp4',
            type: 'video',
            startTime: 8,
            duration: 6.8,
            trackId: 'video-track-2',
            color: '#7c3aed',
            thumbnailUrl: 'https://via.placeholder.com/120x68/7c3aed/ffffff?text=PIP',
            materialId: 'material-4',
            volume: 0.8,
            opacity: 0.9
          }
        ]
      },
      {
        id: 'audio-track-1',
        name: '背景音乐',
        type: 'audio',
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 2,
        items: [
          {
            id: 'audio-item-1',
            name: '背景音乐.mp3',
            type: 'audio',
            startTime: 0,
            duration: 25,
            trackId: 'audio-track-1',
            color: '#10b981',
            waveformData: Array.from({ length: 100 }, () => Math.random() * 0.8 + 0.2),
            materialId: 'material-5',
            volume: 0.3,
            opacity: 1.0
          }
        ]
      },
      {
        id: 'audio-track-2',
        name: '音效轨道',
        type: 'audio',
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 3,
        items: [
          {
            id: 'audio-item-2',
            name: '开场音效.wav',
            type: 'audio',
            startTime: 0,
            duration: 2.1,
            trackId: 'audio-track-2',
            color: '#059669',
            waveformData: Array.from({ length: 20 }, () => Math.random() * 1.0),
            materialId: 'material-6',
            volume: 0.7,
            opacity: 1.0
          },
          {
            id: 'audio-item-3',
            name: '转场音效.wav',
            type: 'audio',
            startTime: 5.5,
            duration: 1.5,
            trackId: 'audio-track-2',
            color: '#047857',
            waveformData: Array.from({ length: 15 }, () => Math.random() * 0.9),
            materialId: 'material-7',
            volume: 0.5,
            opacity: 1.0
          }
        ]
      },
      {
        id: 'subtitle-track-1',
        name: '字幕轨道',
        type: 'subtitle',
        height: 50,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 4,
        items: [
          {
            id: 'subtitle-item-1',
            name: '开场字幕',
            type: 'subtitle',
            startTime: 1,
            duration: 4,
            trackId: 'subtitle-track-1',
            color: '#f59e0b',
            text: '欢迎观看本期视频内容',
            materialId: 'subtitle-1',
            opacity: 1.0
          },
          {
            id: 'subtitle-item-2',
            name: '主要内容字幕',
            type: 'subtitle',
            startTime: 7,
            duration: 10,
            trackId: 'subtitle-track-1',
            color: '#d97706',
            text: '接下来我们将详细介绍...',
            materialId: 'subtitle-2',
            opacity: 1.0
          },
          {
            id: 'subtitle-item-3',
            name: '结尾字幕',
            type: 'subtitle',
            startTime: 20,
            duration: 3,
            trackId: 'subtitle-track-1',
            color: '#b45309',
            text: '感谢您的观看，记得点赞关注！',
            materialId: 'subtitle-3',
            opacity: 1.0
          }
        ]
      }
    ];

    return {
      currentTime: 8.5,
      totalDuration: 25,
      zoomLevel: 1.2,
      selectedItems: ['video-item-2'],
      tracks: mockTracks,
      playbackRate: 1.0,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5
    };
  };

  // 状态管理
  const [timelineState, setTimelineState] = useState<TimelineState>(createMockTimelineState());
  const [activeTool, setActiveTool] = useState<TimelineToolType>('select');
  const [history, setHistory] = useState<TimelineAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  console.log(`[TimelinePanel] 时间轴面板初始化`, {
    trackCount: timelineState.tracks.length,
    totalItems: timelineState.tracks.reduce((sum, track) => sum + track.items.length, 0),
    currentTime: timelineState.currentTime.toFixed(2),
    totalDuration: timelineState.totalDuration.toFixed(2),
    selectedItemsCount: timelineState.selectedItems.length,
    activeTool,
    timestamp: new Date().toISOString()
  });

  // 添加历史记录
  const addToHistory = useCallback((action: TimelineAction) => {
    console.log(`[TimelinePanel] 添加历史记录`, {
      actionType: action.type,
      timestamp: action.timestamp.toISOString()
    });
    
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(action);
      return newHistory.slice(-50); // 保留最近50个操作
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex]);

  // 时间轴操作处理函数
  const handleTimeChange = useCallback((time: number) => {
    console.log(`[TimelinePanel] 时间变更`, {
      oldTime: timelineState.currentTime.toFixed(2),
      newTime: time.toFixed(2),
      timestamp: new Date().toISOString()
    });
    
    setTimelineState(prev => ({
      ...prev,
      currentTime: time
    }));
  }, [timelineState.currentTime]);

  const handleZoomChange = useCallback((zoomLevel: number) => {
    console.log(`[TimelinePanel] 缩放变更`, {
      oldZoom: timelineState.zoomLevel.toFixed(2),
      newZoom: zoomLevel.toFixed(2),
      timestamp: new Date().toISOString()
    });
    
    setTimelineState(prev => ({
      ...prev,
      zoomLevel
    }));
  }, [timelineState.zoomLevel]);

  const handleSelectItem = useCallback((itemId: string, isMultiSelect = false) => {
    console.log(`[TimelinePanel] 选择素材`, {
      itemId,
      isMultiSelect,
      currentSelectedCount: timelineState.selectedItems.length,
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => {
      if (itemId === '') {
        // 取消所有选择
        return { ...prev, selectedItems: [] };
      }

      let newSelectedItems: string[];
      if (isMultiSelect) {
        if (prev.selectedItems.includes(itemId)) {
          newSelectedItems = prev.selectedItems.filter(id => id !== itemId);
        } else {
          newSelectedItems = [...prev.selectedItems, itemId];
        }
      } else {
        newSelectedItems = [itemId];
      }

      return { ...prev, selectedItems: newSelectedItems };
    });

    addToHistory({
      type: 'SELECT_ITEM',
      payload: { itemId, isMultiSelect },
      timestamp: new Date()
    });
  }, [timelineState.selectedItems, addToHistory]);

  const handleMoveItem = useCallback((itemId: string, newStartTime: number) => {
    console.log(`[TimelinePanel] 移动素材`, {
      itemId,
      newStartTime: newStartTime.toFixed(2),
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.map(track => ({
        ...track,
        items: track.items.map(item => 
          item.id === itemId ? { ...item, startTime: newStartTime } : item
        )
      }))
    }));

    addToHistory({
      type: 'MOVE_ITEM',
      payload: { itemId, newStartTime },
      timestamp: new Date()
    });
  }, [addToHistory]);

  const handleResizeItem = useCallback((itemId: string, newDuration: number, resizeType: 'start' | 'end') => {
    console.log(`[TimelinePanel] 调整素材大小`, {
      itemId,
      newDuration: newDuration.toFixed(2),
      resizeType,
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.map(track => ({
        ...track,
        items: track.items.map(item => {
          if (item.id === itemId) {
            if (resizeType === 'start') {
              const deltaTime = item.duration - newDuration;
              return { 
                ...item, 
                duration: newDuration,
                startTime: item.startTime + deltaTime
              };
            } else {
              return { ...item, duration: newDuration };
            }
          }
          return item;
        })
      }))
    }));

    addToHistory({
      type: 'UPDATE_ITEM',
      payload: { itemId, newDuration, resizeType },
      timestamp: new Date()
    });
  }, [addToHistory]);

  // 轨道操作处理函数
  const handleToggleTrackMute = useCallback((trackId: string) => {
    console.log(`[TimelinePanel] 切换轨道静音`, { trackId, timestamp: new Date().toISOString() });
    
    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.map(track => 
        track.id === trackId ? { ...track, isMuted: !track.isMuted } : track
      )
    }));
  }, []);

  const handleToggleTrackLock = useCallback((trackId: string) => {
    console.log(`[TimelinePanel] 切换轨道锁定`, { trackId, timestamp: new Date().toISOString() });
    
    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.map(track => 
        track.id === trackId ? { ...track, isLocked: !track.isLocked } : track
      )
    }));
  }, []);

  const handleToggleTrackVisibility = useCallback((trackId: string) => {
    console.log(`[TimelinePanel] 切换轨道可见性`, { trackId, timestamp: new Date().toISOString() });
    
    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.map(track => 
        track.id === trackId ? { ...track, isVisible: !track.isVisible } : track
      )
    }));
  }, []);

  const handleAddTrack = useCallback((type: 'video' | 'audio' | 'subtitle') => {
    const trackId = `${type}-track-${Date.now()}`;
    const trackName = `${type === 'video' ? '视频' : type === 'audio' ? '音频' : '字幕'}轨道 ${timelineState.tracks.filter(t => t.type === type).length + 1}`;
    const trackHeight = type === 'video' ? 80 : type === 'audio' ? 60 : 50;
    
    console.log(`[TimelinePanel] 添加新轨道`, {
      trackId,
      trackName,
      type,
      timestamp: new Date().toISOString()
    });

    const newTrack: Track = {
      id: trackId,
      name: trackName,
      type,
      height: trackHeight,
      isLocked: false,
      isMuted: false,
      isVisible: true,
      order: timelineState.tracks.length,
      items: []
    };

    setTimelineState(prev => ({
      ...prev,
      tracks: [...prev.tracks, newTrack]
    }));
  }, [timelineState.tracks]);

  const handleRemoveTrack = useCallback((trackId: string) => {
    console.log(`[TimelinePanel] 删除轨道`, { trackId, timestamp: new Date().toISOString() });
    
    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.filter(track => track.id !== trackId)
    }));
  }, []);

  const handleReorderTracks = useCallback((sourceIndex: number, destinationIndex: number) => {
    console.log(`[TimelinePanel] 重新排序轨道`, {
      sourceIndex,
      destinationIndex,
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => {
      const newTracks = [...prev.tracks];
      const [removed] = newTracks.splice(sourceIndex, 1);
      newTracks.splice(destinationIndex, 0, removed);
      
      // 更新order属性
      return {
        ...prev,
        tracks: newTracks.map((track, index) => ({ ...track, order: index }))
      };
    });
  }, []);

  // 工具栏操作处理函数
  const handleToolChange = useCallback((tool: TimelineToolType) => {
    console.log(`[TimelinePanel] 切换工具`, {
      oldTool: activeTool,
      newTool: tool,
      timestamp: new Date().toISOString()
    });
    setActiveTool(tool);
  }, [activeTool]);

  const handleUndo = useCallback(() => {
    if (historyIndex >= 0) {
      console.log(`[TimelinePanel] 执行撤销操作`, {
        historyIndex,
        actionType: history[historyIndex]?.type,
        timestamp: new Date().toISOString()
      });
      setHistoryIndex(prev => prev - 1);
      // 这里应该实现具体的撤销逻辑
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      console.log(`[TimelinePanel] 执行重做操作`, {
        historyIndex,
        actionType: history[historyIndex + 1]?.type,
        timestamp: new Date().toISOString()
      });
      setHistoryIndex(prev => prev + 1);
      // 这里应该实现具体的重做逻辑
    }
  }, [historyIndex, history]);

  // 编辑操作处理函数
  const handleCut = useCallback(() => {
    console.log(`[TimelinePanel] 剪切选中素材`, {
      selectedItemsCount: timelineState.selectedItems.length,
      timestamp: new Date().toISOString()
    });
    // 实现剪切逻辑
  }, [timelineState.selectedItems]);

  const handleCopy = useCallback(() => {
    console.log(`[TimelinePanel] 复制选中素材`, {
      selectedItemsCount: timelineState.selectedItems.length,
      timestamp: new Date().toISOString()
    });
    // 实现复制逻辑
  }, [timelineState.selectedItems]);

  const handlePaste = useCallback(() => {
    console.log(`[TimelinePanel] 粘贴素材`, {
      currentTime: timelineState.currentTime.toFixed(2),
      timestamp: new Date().toISOString()
    });
    // 实现粘贴逻辑
  }, [timelineState.currentTime]);

  const handleDelete = useCallback(() => {
    console.log(`[TimelinePanel] 删除选中素材`, {
      selectedItemsCount: timelineState.selectedItems.length,
      selectedItems: timelineState.selectedItems,
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => ({
      ...prev,
      tracks: prev.tracks.map(track => ({
        ...track,
        items: track.items.filter(item => !prev.selectedItems.includes(item.id))
      })),
      selectedItems: []
    }));

    addToHistory({
      type: 'REMOVE_ITEM',
      payload: { itemIds: timelineState.selectedItems },
      timestamp: new Date()
    });
  }, [timelineState.selectedItems, addToHistory]);

  // 高级功能处理函数
  const handleAddEffect = useCallback(() => {
    console.log(`[TimelinePanel] 添加特效`, { timestamp: new Date().toISOString() });
    // 实现添加特效逻辑
  }, []);

  const handleAddTransition = useCallback(() => {
    console.log(`[TimelinePanel] 添加转场`, { timestamp: new Date().toISOString() });
    // 实现添加转场逻辑
  }, []);

  const handleAddSubtitle = useCallback(() => {
    console.log(`[TimelinePanel] 添加字幕`, { timestamp: new Date().toISOString() });
    // 实现添加字幕逻辑
  }, []);

  const handleExport = useCallback(() => {
    console.log(`[TimelinePanel] 导出视频`, {
      totalDuration: timelineState.totalDuration.toFixed(2),
      trackCount: timelineState.tracks.length,
      timestamp: new Date().toISOString()
    });
    // 实现导出逻辑
  }, [timelineState]);

  return (
    <div className={`timeline-panel flex flex-col h-full bg-white ${className}`}>
      {/* 工具栏 */}
      <TimelineToolbar
        activeTool={activeTool}
        onToolChange={handleToolChange}
        canUndo={historyIndex >= 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        selectedItemsCount={timelineState.selectedItems.length}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDelete={handleDelete}
        onAddEffect={handleAddEffect}
        onAddTransition={handleAddTransition}
        onAddSubtitle={handleAddSubtitle}
        onExport={handleExport}
      />

      {/* 时间刻度尺 */}
      <TimelineRuler
        currentTime={timelineState.currentTime}
        totalDuration={timelineState.totalDuration}
        pixelsPerSecond={timelineState.zoomLevel * 50}
        onTimeChange={handleTimeChange}
        zoomLevel={timelineState.zoomLevel}
        onZoomChange={handleZoomChange}
        isPlaying={timelineState.isPlaying}
      />

      {/* 轨道容器 */}
      <TrackContainer
        timelineState={timelineState}
        onSelectItem={handleSelectItem}
        onMoveItem={handleMoveItem}
        onResizeItem={handleResizeItem}
        onToggleTrackMute={handleToggleTrackMute}
        onToggleTrackLock={handleToggleTrackLock}
        onToggleTrackVisibility={handleToggleTrackVisibility}
        onAddTrack={handleAddTrack}
        onRemoveTrack={handleRemoveTrack}
        onReorderTracks={handleReorderTracks}
      />
    </div>
  );
};

export default TimelinePanel; 