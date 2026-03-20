import { useState, useCallback, useMemo } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { TimelineRepository } from '../timeline/infrastructure';
import type { TimelineData, MaterialData } from '../timeline/domain/types';
import { VideoEditingLogger } from '../utils';
import { useNotification } from '@/contexts/NotificationContext';

export interface UseTimelineExportReturn {
  isExporting: boolean;
  exportError: string | null;
  exportTimelineToJSON: (timelineState: TimelineState, materials: MaterialItem[]) => Promise<void>;
  clearError: () => void;
}

/**
 * useTimelineExport Hook
 * 管理时间轴导出为JSON的功能
 *
 * Simplified: export/import logic has been moved to TimelineRepository
 * in the infrastructure layer. This hook now delegates to that adapter
 * and manages only the React-specific UI state (loading, errors, notifications).
 *
 * @param taskId - 任务ID，用于日志记录
 * @returns 时间轴导出相关的状态和方法
 */
export const useTimelineExport = (taskId: string): UseTimelineExportReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useTimelineExport'
  }), [taskId]);

  // Infrastructure adapter for timeline persistence
  const repository = useMemo(() => new TimelineRepository(), []);

  // 通知系统
  const { showSuccess, showError } = useNotification();

  // 状态管理
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // 清除错误信息
  const clearError = useCallback(() => {
    setExportError(null);
  }, []);

  // 导出时间轴为JSON
  const exportTimelineToJSON = useCallback(async (
    timelineState: TimelineState,
    materials: MaterialItem[]
  ) => {
    try {
      setIsExporting(true);
      setExportError(null);

      logger.info('开始导出时间轴JSON', {
        trackCount: timelineState.tracks.length,
        materialCount: materials.length,
        totalDuration: timelineState.totalDuration
      });

      // 验证输入数据
      if (!timelineState || !timelineState.tracks) {
        throw new Error('无效的时间轴状态数据');
      }

      if (!Array.isArray(materials)) {
        throw new Error('无效的素材数据');
      }

      // Convert to domain-compatible shapes
      const timelineData: TimelineData = {
        currentTime: timelineState.currentTime,
        totalDuration: timelineState.totalDuration,
        zoomLevel: timelineState.zoomLevel,
        playbackRate: timelineState.playbackRate,
        isPlaying: timelineState.isPlaying,
        snapToGrid: timelineState.snapToGrid,
        gridSize: timelineState.gridSize,
        scrollLeft: timelineState.scrollLeft,
        tracks: timelineState.tracks.map(track => ({
          id: track.id,
          name: track.name,
          type: track.type as 'video' | 'audio' | 'subtitle',
          height: track.height,
          isLocked: track.isLocked,
          isMuted: track.isMuted,
          isVisible: track.isVisible,
          volume: track.volume,
          order: track.order,
          items: track.items.map(item => ({
            id: item.id,
            name: item.name,
            type: item.type as 'video' | 'audio' | 'subtitle',
            startTime: item.startTime,
            duration: item.duration,
            trackId: item.trackId,
            color: item.color,
            materialId: item.materialId,
            clipStart: item.clipStart,
            clipEnd: item.clipEnd,
            originalDuration: item.originalDuration,
            thumbnailUrl: item.thumbnailUrl,
            waveformData: item.waveformData,
            text: item.text,
            volume: item.volume,
            opacity: item.opacity,
            isSelected: item.isSelected,
            originalMaterialType: item.originalMaterialType,
            subtitleStyle: item.subtitleStyle,
            imagePosition: item.imagePosition,
          })),
        })),
      };

      const materialData: MaterialData[] = materials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        duration: m.duration,
        thumbnailUrl: m.thumbnailUrl,
        url: m.url,
      }));

      // Use TimelineRepository to export
      const { blob, filename } = await repository.exportToJSON(
        timelineData,
        materialData,
        {
          exportedAt: new Date().toISOString(),
          version: '1.0.0',
          taskId,
        }
      );

      // Download the blob
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showSuccess(`时间轴数据已成功导出为JSON文件: ${filename}`, 5000);

      logger.info('时间轴JSON导出成功', {
        fileName: filename,
        trackCount: timelineState.tracks.length
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setExportError(errorMessage);

      showError(`时间轴数据导出失败: ${errorMessage}`, 8000);

      logger.error('时间轴JSON导出失败', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        trackCount: timelineState?.tracks?.length || 0,
        materialCount: materials?.length || 0
      });

    } finally {
      setIsExporting(false);
    }
  }, [taskId, repository, logger, showSuccess, showError]);

  return {
    isExporting,
    exportError,
    exportTimelineToJSON,
    clearError
  };
};
