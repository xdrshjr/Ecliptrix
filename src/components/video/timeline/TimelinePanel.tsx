'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { TimelineState, TimelineToolType, Track, TimelineItem, TimelineAction, MaterialItem } from '@/types';
import { getTranslations, defaultLocale, type SupportedLocale } from '@/lib/i18n';
import TimelineToolbar from './TimelineToolbar';
import TimelineRuler from './TimelineRuler';
import TrackContainer from './TrackContainer';

interface TimelinePanelProps {
  className?: string;
  onTimelineStateChange?: (timelineState: TimelineState) => void;
  // 新增：外部控制当前时间
  externalCurrentTime?: number;
  onCurrentTimeChange?: (time: number) => void;
  // 新增：素材列表，用于导出功能
  materials?: MaterialItem[];
  // 国际化支持
  locale?: SupportedLocale;
}

const TimelinePanel: React.FC<TimelinePanelProps> = ({ 
  className = '', 
  onTimelineStateChange, 
  externalCurrentTime,
  onCurrentTimeChange,
  materials = [],
  locale = defaultLocale
}) => {
  // 创建初始空轨道状态
  const createInitialTimelineState = (): TimelineState => {
    const initialTracks: Track[] = [
      {
        id: 'video-track-1',
        name: '视频轨道 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 0,
        items: []
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
        items: []
      },
      {
        id: 'audio-track-1',
        name: '音频轨道 1',
        type: 'audio',
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 2,
        items: []
      },
      {
        id: 'audio-track-2',
        name: '音频轨道 2',
        type: 'audio',
        height: 60,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        order: 3,
        items: []
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
        items: []
      }
    ];

    return {
      currentTime: 0,
      totalDuration: 0,
      zoomLevel: 1.0,
      selectedItems: [],
      tracks: initialTracks,
      playbackRate: 1.0,
      isPlaying: false,
      snapToGrid: true,
      gridSize: 0.5
    };
  };

  // 状态管理
  const [timelineState, setTimelineState] = useState<TimelineState>(createInitialTimelineState());
  const [activeTool, setActiveTool] = useState<TimelineToolType>('select');
  const [history, setHistory] = useState<TimelineAction[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isExporting, setIsExporting] = useState(false); // 导出状态
  const [exportProgress, setExportProgress] = useState(0); // 导出进度

  // 通知父组件时间轴状态变化
  useEffect(() => {
    if (onTimelineStateChange) {
      console.log(`[TimelinePanel] 通知父组件时间轴状态变化`, {
        totalDuration: timelineState.totalDuration,
        tracksCount: timelineState.tracks.length,
        itemsCount: timelineState.tracks.reduce((total, track) => total + track.items.length, 0),
        timestamp: new Date().toISOString()
      });
      onTimelineStateChange(timelineState);
    }
  }, [timelineState, onTimelineStateChange]);

  // 处理外部时间同步
  useEffect(() => {
    if (externalCurrentTime !== undefined && externalCurrentTime !== timelineState.currentTime) {
      console.log(`[TimelinePanel] 外部时间同步`, {
        previousTime: timelineState.currentTime.toFixed(2),
        externalTime: externalCurrentTime.toFixed(2),
        timeDiff: Math.abs(externalCurrentTime - timelineState.currentTime).toFixed(2),
        timestamp: new Date().toISOString()
      });
      
      setTimelineState(prev => ({
        ...prev,
        currentTime: externalCurrentTime
      }));
    }
  }, [externalCurrentTime, timelineState.currentTime]);

  // 生成唯一ID的辅助函数
  const generateId = () => `item-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // 根据素材类型获取颜色
  const getMaterialColor = (materialType: string): string => {
    switch (materialType) {
      case 'video': return '#3b82f6';
      case 'audio': return '#10b981';
      case 'image': return '#8b5cf6';
      default: return '#6b7280';
    }
  };

  // 计算轨道中最后一个素材的结束时间
  const getTrackEndTime = (trackItems: TimelineItem[]): number => {
    if (trackItems.length === 0) return 0;
    return Math.max(...trackItems.map(item => item.startTime + item.duration));
  };

  // 处理从素材面板拖拽的素材
  const handleMaterialDrop = useCallback((material: MaterialItem, targetTrackId?: string) => {
    console.log(`[TimelinePanel] 处理素材拖拽放置`, {
      materialId: material.id,
      materialName: material.name,
      materialType: material.type,
      targetTrackId,
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => {
      // 找到合适的轨道
      let targetTrack: Track | null = null;
      
      if (targetTrackId) {
        // 如果指定了目标轨道，直接使用
        targetTrack = prev.tracks.find(track => track.id === targetTrackId) || null;
      } else {
        // 根据素材类型自动选择轨道
        const compatibleTracks = prev.tracks.filter(track => {
          // 视频可以放在视频轨道，音频可以放在音频轨道，图片可以放在视频轨道
          if (material.type === 'video') return track.type === 'video';
          if (material.type === 'audio') return track.type === 'audio';
          if (material.type === 'image') return track.type === 'video'; // 图片放在视频轨道
          return false;
        });

        // 选择第一个可用的轨道
        targetTrack = compatibleTracks[0] || null;
      }

      if (!targetTrack) {
        console.warn(`[TimelinePanel] 未找到合适的轨道`, {
          materialType: material.type,
          availableTracks: prev.tracks.map(t => ({ id: t.id, type: t.type }))
        });
        return prev;
      }

      // 计算新素材的开始时间（追加到轨道末尾）
      const startTime = getTrackEndTime(targetTrack.items);
      const duration = material.duration || 5; // 如果没有时长信息，默认5秒

      // 创建新的时间轴项目
      const newTimelineItem: TimelineItem = {
        id: generateId(),
        name: material.name,
        type: material.type === 'image' ? 'video' : material.type as 'video' | 'audio' | 'subtitle',
        startTime,
        duration,
        trackId: targetTrack.id,
        color: getMaterialColor(material.type),
        materialId: material.id,
        volume: 1.0,
        opacity: 1.0,
        thumbnailUrl: material.thumbnailUrl,
        waveformData: material.type === 'audio' ? Array.from({ length: 50 }, () => Math.random() * 0.8 + 0.2) : undefined,
        
        // 初始化剪辑属性：默认使用完整的原始素材
        clipStart: 0,
        clipEnd: duration,
        originalDuration: duration
      };

      console.log(`[TimelinePanel] 创建新时间轴项目`, {
        itemId: newTimelineItem.id,
        trackId: targetTrack.id,
        startTime: startTime.toFixed(2),
        duration: duration.toFixed(2),
        materialType: material.type,
        timestamp: new Date().toISOString()
      });

      // 更新轨道和总时长
      const newTracks = prev.tracks.map(track => {
        if (track.id === targetTrack!.id) {
          return {
            ...track,
            items: [...track.items, newTimelineItem]
          };
        }
        return track;
      });

      // 计算新的总时长
      const allItemEndTimes = newTracks.flatMap(track => 
        track.items.map(item => item.startTime + item.duration)
      );
      const maxItemEndTime = Math.max(...allItemEndTimes, startTime + duration);
      const newTotalDuration = Math.max(prev.totalDuration, maxItemEndTime);
      
      console.log(`[TimelinePanel] 总时长计算`, {
        previousTotalDuration: prev.totalDuration,
        newItemEndTime: startTime + duration,
        allItemEndTimes: allItemEndTimes,
        maxItemEndTime: maxItemEndTime,
        newTotalDuration: newTotalDuration,
        materialName: material.name,
        timestamp: new Date().toISOString()
      });

      return {
        ...prev,
        tracks: newTracks,
        totalDuration: newTotalDuration
      };
    });

    // 添加到历史记录
    addToHistory({
      type: 'ADD_ITEM',
      payload: { materialId: material.id, materialName: material.name },
      timestamp: new Date()
    });
  }, []);

  // 历史记录管理
  const addToHistory = useCallback((action: TimelineAction) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(action);
      return newHistory.slice(-50); // 保留最近50个操作
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // 初始化日志记录
  useEffect(() => {
    console.log(`[TimelinePanel] 时间轴面板初始化`, {
      trackCount: timelineState.tracks.length,
      totalItems: timelineState.tracks.reduce((sum, track) => sum + track.items.length, 0),
      currentTime: timelineState.currentTime.toFixed(2),
      totalDuration: timelineState.totalDuration.toFixed(2),
      selectedItemsCount: timelineState.selectedItems.length,
      activeTool,
      timestamp: new Date().toISOString()
    });
  }, [timelineState.tracks, timelineState.currentTime, timelineState.totalDuration, timelineState.selectedItems, activeTool]);

  // 时间轴操作处理函数
  const handleTimeChange = useCallback((time: number) => {
    console.log(`[TimelinePanel] 用户拖拽游标时间变更`, {
      oldTime: timelineState.currentTime.toFixed(2),
      newTime: time.toFixed(2),
      source: 'user_interaction',
      timestamp: new Date().toISOString()
    });
    
    setTimelineState(prev => ({
      ...prev,
      currentTime: time
    }));

    // 通知外部组件时间变化（用于同步到视频播放器）
    if (onCurrentTimeChange) {
      console.log(`[TimelinePanel] 通知外部组件时间变化`, {
        newTime: time.toFixed(2),
        timestamp: new Date().toISOString()
      });
      onCurrentTimeChange(time);
    }
  }, [timelineState.currentTime, onCurrentTimeChange]);

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

  // 计算非重叠位置的辅助函数
  const calculateNonOverlappingPosition = useCallback((
    targetItem: TimelineItem, 
    newStartTime: number, 
    trackItems: TimelineItem[]
  ): number => {
    const targetEndTime = newStartTime + targetItem.duration;
    const otherItems = trackItems.filter(item => item.id !== targetItem.id);
    
    console.log(`[TimelinePanel] 开始碰撞检测`, {
      itemId: targetItem.id,
      requestedStartTime: newStartTime.toFixed(2),
      requestedEndTime: targetEndTime.toFixed(2),
      otherItemsCount: otherItems.length,
      timestamp: new Date().toISOString()
    });

    // 检查是否与其他素材重叠
    for (const otherItem of otherItems) {
      const otherEndTime = otherItem.startTime + otherItem.duration;
      
      // 检查重叠：目标素材的开始时间在其他素材范围内，或目标素材的结束时间在其他素材范围内
      const isOverlapping = (
        (newStartTime >= otherItem.startTime && newStartTime < otherEndTime) ||
        (targetEndTime > otherItem.startTime && targetEndTime <= otherEndTime) ||
        (newStartTime <= otherItem.startTime && targetEndTime >= otherEndTime)
      );

      if (isOverlapping) {
        console.log(`[TimelinePanel] 检测到重叠`, {
          targetItemId: targetItem.id,
          overlappingItemId: otherItem.id,
          otherItemStart: otherItem.startTime.toFixed(2),
          otherItemEnd: otherEndTime.toFixed(2),
          timestamp: new Date().toISOString()
        });

        // 计算调整后的位置：如果往右移动重叠，则放到其他素材前面；如果往左移动重叠，则放到其他素材后面
        let adjustedStartTime: number;
        
        if (newStartTime >= targetItem.startTime) {
          // 往右移动，放到重叠素材的前面
          adjustedStartTime = Math.max(0, otherItem.startTime - targetItem.duration);
        } else {
          // 往左移动，放到重叠素材的后面
          adjustedStartTime = otherEndTime;
        }

        console.log(`[TimelinePanel] 调整位置避免重叠`, {
          originalStartTime: newStartTime.toFixed(2),
          adjustedStartTime: adjustedStartTime.toFixed(2),
          adjustmentReason: newStartTime >= targetItem.startTime ? 'moved_right' : 'moved_left',
          timestamp: new Date().toISOString()
        });

        // 递归检查调整后的位置是否还有重叠
        return calculateNonOverlappingPosition(targetItem, adjustedStartTime, trackItems);
      }
    }

    console.log(`[TimelinePanel] 位置检查通过`, {
      finalStartTime: newStartTime.toFixed(2),
      finalEndTime: targetEndTime.toFixed(2),
      timestamp: new Date().toISOString()
    });

    return Math.max(0, newStartTime); // 确保不小于0
  }, []);

  // 计算非重叠resize位置的辅助函数
  const calculateNonOverlappingResizeParams = useCallback((
    targetItem: TimelineItem,
    newDuration: number,
    resizeType: 'start' | 'end',
    trackItems: TimelineItem[]
  ): { duration: number; startTime: number } => {
    const otherItems = trackItems.filter(item => item.id !== targetItem.id);
    
    console.log(`[TimelinePanel] 开始resize碰撞检测`, {
      itemId: targetItem.id,
      resizeType,
      currentStartTime: targetItem.startTime.toFixed(2),
      currentDuration: targetItem.duration.toFixed(2),
      requestedDuration: newDuration.toFixed(2),
      otherItemsCount: otherItems.length,
      timestamp: new Date().toISOString()
    });

    if (resizeType === 'end') {
      // 调整结束时间：检查新的结束位置是否与后面的素材重叠
      const newEndTime = targetItem.startTime + newDuration;
      
      // 找到最近的后续素材
      const nextItem = otherItems
        .filter(item => item.startTime >= targetItem.startTime)
        .sort((a, b) => a.startTime - b.startTime)[0];
      
      if (nextItem && newEndTime > nextItem.startTime) {
        const maxAllowedDuration = nextItem.startTime - targetItem.startTime;
        const adjustedDuration = Math.max(0.1, maxAllowedDuration);
        
        console.log(`[TimelinePanel] End resize受限于后续素材`, {
          itemId: targetItem.id,
          nextItemId: nextItem.id,
          nextItemStart: nextItem.startTime.toFixed(2),
          requestedDuration: newDuration.toFixed(2),
          adjustedDuration: adjustedDuration.toFixed(2),
          timestamp: new Date().toISOString()
        });
        
        return { duration: adjustedDuration, startTime: targetItem.startTime };
      }
      
      return { duration: newDuration, startTime: targetItem.startTime };
      
    } else {
      // 调整开始时间：检查新的开始位置是否与前面的素材重叠
      const originalEndTime = targetItem.startTime + targetItem.duration;
      const newStartTime = originalEndTime - newDuration;
      
      // 找到最近的前置素材
      const prevItem = otherItems
        .filter(item => item.startTime + item.duration <= targetItem.startTime)
        .sort((a, b) => (b.startTime + b.duration) - (a.startTime + a.duration))[0];
      
      if (prevItem && newStartTime < prevItem.startTime + prevItem.duration) {
        const minAllowedStartTime = prevItem.startTime + prevItem.duration;
        const adjustedDuration = Math.max(0.1, originalEndTime - minAllowedStartTime);
        
        console.log(`[TimelinePanel] Start resize受限于前置素材`, {
          itemId: targetItem.id,
          prevItemId: prevItem.id,
          prevItemEnd: (prevItem.startTime + prevItem.duration).toFixed(2),
          requestedStartTime: newStartTime.toFixed(2),
          adjustedStartTime: minAllowedStartTime.toFixed(2),
          adjustedDuration: adjustedDuration.toFixed(2),
          timestamp: new Date().toISOString()
        });
        
        return { duration: adjustedDuration, startTime: minAllowedStartTime };
      }
      
      // 还要检查不能超过时间轴开始位置
      const finalStartTime = Math.max(0, newStartTime);
      const finalDuration = originalEndTime - finalStartTime;
      
      return { duration: Math.max(0.1, finalDuration), startTime: finalStartTime };
    }
  }, []);

  const handleMoveItem = useCallback((itemId: string, newStartTime: number) => {
    console.log(`[TimelinePanel] 移动素材开始`, {
      itemId,
      requestedStartTime: newStartTime.toFixed(2),
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => {
      // 找到目标素材和所在轨道
      let targetItem: TimelineItem | null = null;
      let targetTrack: Track | null = null;

      for (const track of prev.tracks) {
        const item = track.items.find(item => item.id === itemId);
        if (item) {
          targetItem = item;
          targetTrack = track;
          break;
        }
      }

      if (!targetItem || !targetTrack) {
        console.warn(`[TimelinePanel] 未找到目标素材`, { itemId });
        return prev;
      }

      // 计算防重叠的位置
      const finalStartTime = calculateNonOverlappingPosition(targetItem, newStartTime, targetTrack.items);

      console.log(`[TimelinePanel] 移动素材完成`, {
        itemId,
        originalStartTime: targetItem.startTime.toFixed(2),
        requestedStartTime: newStartTime.toFixed(2),
        finalStartTime: finalStartTime.toFixed(2),
        positionAdjusted: Math.abs(finalStartTime - newStartTime) > 0.01,
        timestamp: new Date().toISOString()
      });

      return {
        ...prev,
        tracks: prev.tracks.map(track => ({
          ...track,
          items: track.items.map(item => 
            item.id === itemId ? { ...item, startTime: finalStartTime } : item
          )
        }))
      };
    });

    addToHistory({
      type: 'MOVE_ITEM',
      payload: { itemId, newStartTime },
      timestamp: new Date()
    });
  }, [addToHistory, calculateNonOverlappingPosition]);

  const handleResizeItem = useCallback((itemId: string, newDuration: number, resizeType: 'start' | 'end') => {
    console.log(`[TimelinePanel] 调整素材大小开始`, {
      itemId,
      newDuration: newDuration.toFixed(2),
      resizeType,
      timestamp: new Date().toISOString()
    });

    setTimelineState(prev => {
      // 找到目标素材和所在轨道
      let targetItem: TimelineItem | null = null;
      let targetTrack: Track | null = null;

      for (const track of prev.tracks) {
        const item = track.items.find(item => item.id === itemId);
        if (item) {
          targetItem = item;
          targetTrack = track;
          break;
        }
      }

      if (!targetItem || !targetTrack) {
        console.warn(`[TimelinePanel] 未找到目标素材进行大小调整`, { itemId });
        return prev;
      }

      // 使用碰撞检测计算最终的参数
      const resizeParams = calculateNonOverlappingResizeParams(
        targetItem, 
        newDuration, 
        resizeType, 
        targetTrack.items
      );

      console.log(`[TimelinePanel] 调整素材大小详情`, {
        itemId,
        resizeType,
        originalStartTime: targetItem.startTime.toFixed(2),
        originalDuration: targetItem.duration.toFixed(2),
        requestedDuration: newDuration.toFixed(2),
        finalDuration: resizeParams.duration.toFixed(2),
        finalStartTime: resizeParams.startTime.toFixed(2),
        wasAdjusted: Math.abs(resizeParams.duration - newDuration) > 0.01 || 
                     Math.abs(resizeParams.startTime - targetItem.startTime) > 0.01,
        timestamp: new Date().toISOString()
      });

      return {
        ...prev,
        tracks: prev.tracks.map(track => ({
          ...track,
          items: track.items.map(item => {
            if (item.id === itemId) {
              console.log(`[TimelinePanel] 应用resize结果`, {
                itemId,
                resizeType,
                beforeStartTime: item.startTime.toFixed(2),
                beforeDuration: item.duration.toFixed(2),
                afterStartTime: resizeParams.startTime.toFixed(2),
                afterDuration: resizeParams.duration.toFixed(2),
                timestamp: new Date().toISOString()
              });
              
              // 计算剪辑属性
              const originalDuration = item.originalDuration || item.duration;
              let newClipStart = item.clipStart || 0;
              let newClipEnd = item.clipEnd || originalDuration;
              
              if (resizeType === 'end') {
                // 调整结束时间：修改clipEnd
                newClipEnd = Math.min(
                  newClipStart + resizeParams.duration, 
                  originalDuration
                );
              } else if (resizeType === 'start') {
                // 调整开始时间：修改clipStart，保持clipEnd不变
                const clipDuration = newClipEnd - newClipStart;
                const durationChange = resizeParams.duration - item.duration;
                newClipStart = Math.max(0, newClipStart - durationChange);
                newClipEnd = Math.min(newClipStart + resizeParams.duration, originalDuration);
              }
              
              console.log(`[TimelinePanel] 更新剪辑属性`, {
                itemId,
                resizeType,
                originalDuration: originalDuration.toFixed(2),
                oldClipStart: (item.clipStart || 0).toFixed(2),
                oldClipEnd: (item.clipEnd || originalDuration).toFixed(2),
                newClipStart: newClipStart.toFixed(2),
                newClipEnd: newClipEnd.toFixed(2),
                clipDuration: (newClipEnd - newClipStart).toFixed(2),
                timelineDuration: resizeParams.duration.toFixed(2),
                timestamp: new Date().toISOString()
              });
              
              return { 
                ...item, 
                duration: resizeParams.duration,
                startTime: resizeParams.startTime,
                clipStart: newClipStart,
                clipEnd: newClipEnd,
                originalDuration: originalDuration
              };
            }
            return item;
          })
        }))
      };
    });

    addToHistory({
      type: 'UPDATE_ITEM',
      payload: { itemId, newDuration, resizeType },
      timestamp: new Date()
    });
  }, [addToHistory, calculateNonOverlappingResizeParams]);

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
    // 使用国际化轨道名称
    const t = getTranslations(locale);
    const baseTrackName = type === 'video' ? t.timeline.track.videoTrack : 
                         type === 'audio' ? t.timeline.track.audioTrack : 
                         t.timeline.track.subtitleTrack;
    const trackName = `${baseTrackName} ${timelineState.tracks.filter(t => t.type === type).length + 1}`;
    const trackHeight = 32; // 统一使用32px高度
    
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

  const handleExport = useCallback(async () => {
    console.log(`[TimelinePanel] 开始导出视频`, {
      totalDuration: timelineState.totalDuration.toFixed(2),
      trackCount: timelineState.tracks.length,
      timestamp: new Date().toISOString()
    });

    // 设置导出状态
    setIsExporting(true);
    setExportProgress(0);

    try {
      // Import the video composition API
      const { videoCompositionAPI } = await import('@/lib/api/videoComposition');
      
      // Extract video items from timeline
      const videoItems: any[] = [];
      const audioItems: any[] = [];
      const subtitleItems: any[] = [];

      console.log(`[TimelinePanel] 开始处理轨道内容`, {
        totalTracks: timelineState.tracks.length,
        timestamp: new Date().toISOString()
      });

      // Process each track
      timelineState.tracks.forEach(track => {
        if (!track.isVisible || track.isLocked) {
          console.log(`[TimelinePanel] 跳过轨道 ${track.id} (不可见或已锁定)`, {
            trackName: track.name,
            isVisible: track.isVisible,
            isLocked: track.isLocked
          });
          return;
        }

        track.items.forEach(item => {
          if (item.type === 'video') {
            // Find the material to get the URL
            const material = materials?.find(m => m.id === item.materialId);
            if (material) {
              // 优先使用服务器URL（Supabase URL），如果没有则使用本地URL
              // 这样确保视频合成时后端能够正确下载文件
              const videoUrl = material.serverUrl || material.url;
              
              console.log(`[TimelinePanel] 处理视频项目`, {
                itemId: item.id,
                itemName: item.name,
                materialUrl: material.url,
                serverUrl: material.serverUrl,
                finalUrl: videoUrl,
                trackId: track.id
              });

              videoItems.push({
                id: item.id,
                name: item.name,
                url: videoUrl,
                start_time: item.startTime,
                duration: item.duration,
                track_id: track.id,
                volume: item.volume || 1.0,
                opacity: item.opacity || 1.0,
                // 新增：剪辑信息，用于后端视频裁剪
                clip_start: item.clipStart || 0,
                clip_end: item.clipEnd || (item.originalDuration || item.duration)
              });
              console.log(`[TimelinePanel] 添加视频项目`, {
                itemId: item.id,
                itemName: item.name,
                finalUrl: videoUrl,
                trackId: track.id,
                startTime: item.startTime.toFixed(2),
                clipStart: (item.clipStart || 0).toFixed(2),
                clipEnd: (item.clipEnd || (item.originalDuration || item.duration)).toFixed(2),
                clipDuration: ((item.clipEnd || (item.originalDuration || item.duration)) - (item.clipStart || 0)).toFixed(2),
                timelineDuration: item.duration.toFixed(2)
              });
            } else {
              console.warn(`[TimelinePanel] 未找到素材 ${item.materialId} 对应的URL`);
            }
          } else if (item.type === 'audio') {
            // Find the material to get the URL
            const material = materials?.find(m => m.id === item.materialId);
            if (material) {
              // 优先使用服务器URL，如果没有则使用普通URL
              const audioUrl = material.serverUrl || material.url;
              
              console.log(`[TimelinePanel] 处理音频项目`, {
                itemId: item.id,
                itemName: item.name,
                materialUrl: material.url,
                serverUrl: material.serverUrl,
                finalUrl: audioUrl,
                trackId: track.id
              });

              audioItems.push({
                id: item.id,
                name: item.name,
                url: audioUrl,
                start_time: item.startTime,
                duration: item.duration,
                track_id: track.id,
                volume: item.volume || 1.0,
                // 新增：剪辑信息，用于后端音频裁剪
                clip_start: item.clipStart || 0,
                clip_end: item.clipEnd || (item.originalDuration || item.duration)
              });
              console.log(`[TimelinePanel] 添加音频项目`, {
                itemId: item.id,
                itemName: item.name,
                finalUrl: audioUrl,
                trackId: track.id,
                startTime: item.startTime.toFixed(2),
                clipStart: (item.clipStart || 0).toFixed(2),
                clipEnd: (item.clipEnd || (item.originalDuration || item.duration)).toFixed(2),
                clipDuration: ((item.clipEnd || (item.originalDuration || item.duration)) - (item.clipStart || 0)).toFixed(2),
                timelineDuration: item.duration.toFixed(2)
              });
            } else {
              console.warn(`[TimelinePanel] 未找到音频素材 ${item.materialId} 对应的URL`);
            }
          } else if (item.type === 'subtitle') {
            subtitleItems.push({
              id: item.id,
              name: item.name,
              text: item.text || item.name, // Use text if available, otherwise use name
              start_time: item.startTime,
              duration: item.duration,
              track_id: track.id,
              font_size: 24,
              font_color: '#FFFFFF',
              position: 'bottom'
            });
          }
        });
      });

      // 关键修改：确保前端按照正确的timeline顺序排序，后端就不需要重新排序
      // 按start_time排序所有项目，确保时间轴顺序正确
      videoItems.sort((a, b) => a.start_time - b.start_time);
      audioItems.sort((a, b) => a.start_time - b.start_time);
      subtitleItems.sort((a, b) => a.start_time - b.start_time);

      console.log(`[TimelinePanel] 完成前端排序`, {
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        videoOrder: videoItems.map((item, index) => ({
          index,
          id: item.id,
          name: item.name,
          start_time: item.start_time.toFixed(2),
          track_id: item.track_id
        })),
        audioOrder: audioItems.map((item, index) => ({
          index,
          id: item.id,
          name: item.name,
          start_time: item.start_time.toFixed(2),
          track_id: item.track_id
        }))
      });

      // Validate we have content to export
      if (videoItems.length === 0) {
        console.warn(`[TimelinePanel] 没有视频内容可导出`);
        alert('没有视频内容可导出，请先添加视频素材到时间轴');
        return;
      }

      // 计算各轨道的最大结束时间用于验证
      const videoEndTimes = videoItems.map(item => item.start_time + item.duration);
      const audioEndTimes = audioItems.map(item => item.start_time + item.duration);
      const maxVideoEndTime = videoEndTimes.length > 0 ? Math.max(...videoEndTimes) : 0;
      const maxAudioEndTime = audioEndTimes.length > 0 ? Math.max(...audioEndTimes) : 0;
      const calculatedTotalDuration = Math.max(maxVideoEndTime, maxAudioEndTime);

      console.log(`[TimelinePanel] 准备导出内容`, {
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        totalDuration: timelineState.totalDuration,
        calculatedTotalDuration: calculatedTotalDuration,
        maxVideoEndTime: maxVideoEndTime,
        maxAudioEndTime: maxAudioEndTime,
        durationMatch: Math.abs(timelineState.totalDuration - calculatedTotalDuration) < 0.1,
        videoItems: videoItems.map(item => ({
          id: item.id,
          name: item.name,
          start_time: item.start_time,
          duration: item.duration,
          end_time: item.start_time + item.duration
        })),
        audioItems: audioItems.map(item => ({
          id: item.id,
          name: item.name,
          url: item.url,
          start_time: item.start_time,
          duration: item.duration,
          end_time: item.start_time + item.duration,
          isServerUrl: item.url.includes('/api/audio/generated/')
        }))
      });

      setExportProgress(10); // 设置初始进度

      // Create composition request
      const compositionRequest = {
        task_id: `export_${Date.now()}`, // Generate a unique task ID
        video_items: videoItems,
        audio_items: audioItems,
        subtitle_items: subtitleItems,
        total_duration: timelineState.totalDuration,
        output_resolution: {
          width: 1920,
          height: 1080
        },
        output_fps: 30,
        output_format: 'mp4'
      };

      setExportProgress(20); // 更新进度

      // Show loading state (you might want to add a loading UI here)
      console.log(`[TimelinePanel] 发送合成请求...`);
      
      // Start video composition
      const compositionResponse = await videoCompositionAPI.composeVideo(compositionRequest);
      
      if (!compositionResponse.success || !compositionResponse.composition_id) {
        throw new Error(compositionResponse.message || '视频合成请求失败');
      }

      console.log(`[TimelinePanel] 合成开始`, {
        compositionId: compositionResponse.composition_id,
        status: compositionResponse.status
      });

      setExportProgress(30); // 更新进度

      // If composition is already completed (unlikely but possible)
      if (compositionResponse.status === 'completed') {
        console.log(`[TimelinePanel] 合成立即完成，开始下载`);
        setExportProgress(100);
        await videoCompositionAPI.triggerDownload(
          compositionResponse.composition_id,
          compositionRequest.task_id,
          `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
        );
        return;
      }

      // Poll for completion and show progress
      console.log(`[TimelinePanel] 开始轮询合成状态...`);
      
      await videoCompositionAPI.pollCompositionStatus(
        compositionResponse.composition_id,
        (status) => {
          const progressPercent = Math.max(30, Math.min(95, 30 + (status.progress * 65)));
          setExportProgress(progressPercent);
          console.log(`[TimelinePanel] 合成进度更新`, {
            progress: (status.progress * 100).toFixed(1) + '%',
            displayProgress: progressPercent.toFixed(1) + '%',
            status: status.status
          });
          // Here you could update a progress UI
        }
      );

      setExportProgress(95); // 设置接近完成的进度

      // Download completed video
      console.log(`[TimelinePanel] 合成完成，开始自动下载...`);
      await videoCompositionAPI.triggerDownload(
        compositionResponse.composition_id,
        compositionRequest.task_id,
        `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
      );

      setExportProgress(100); // 完成
      console.log(`[TimelinePanel] 视频导出完成`);
      
    } catch (error) {
      console.error(`[TimelinePanel] 导出失败`, error);
      alert(`视频导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      // 重置导出状态
      setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
      }, 2000); // 2秒后重置状态
    }
  }, [timelineState, materials]);

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
        isExporting={isExporting}
        exportProgress={exportProgress}
        locale={locale}
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
        onMaterialDrop={handleMaterialDrop}
        locale={locale}
      />
    </div>
  );
};

export default TimelinePanel; 