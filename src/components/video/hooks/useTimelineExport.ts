import { useState, useCallback, useMemo, useRef } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { TimelineRepository, getSerializedTrackKind } from '../timeline/infrastructure';
import type { TimelineData, MaterialData } from '../timeline/domain/types';
import { VideoEditingLogger } from '../utils';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { deriveTrackDisplayName } from '../timeline/trackDisplayName';
import { useTimelineStore } from '../timeline/store';

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
export const useTimelineExport = (taskId: string, coverSchemaVersion?: 2): UseTimelineExportReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useTimelineExport'
  }), [taskId]);

  // Infrastructure adapter for timeline persistence
  const repository = useMemo(() => new TimelineRepository(), []);

  // 通知系统
  const { showSuccess, showError } = useNotification();

  // i18n
  const { t } = useLocale();

  // 状态管理
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 同步再入防抖：React useState 更新异步，快速按键可能在 state 未刷新前再次进入，
  // 用 ref 做同步闸门；同时把 store 的 isExporting flag 一并写真，让工具栏 disabled 生效。
  const exportingRef = useRef(false);

  // 清除错误信息
  const clearError = useCallback(() => {
    setExportError(null);
  }, []);

  // 导出时间轴为JSON
  const exportTimelineToJSON = useCallback(async (
    timelineState: TimelineState,
    materials: MaterialItem[]
  ) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    try {
      setIsExporting(true);
      useTimelineStore.getState().setExporting(true);
      setExportError(null);

      logger.info('开始导出时间轴JSON', {
        trackCount: timelineState.tracks.length,
        materialCount: materials.length,
        totalDuration: timelineState.totalDuration
      });

      // 验证输入数据
      if (!timelineState || !timelineState.tracks) {
        throw new Error(t.timeline.messages.exportInvalidTimelineState);
      }

      if (!Array.isArray(materials)) {
        throw new Error(t.timeline.messages.exportInvalidMaterials);
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
        tracks: timelineState.tracks.map(track => {
          const kind = getSerializedTrackKind(track);
          // Pre-derive the locale-aware display name so exported JSON never
          // contains blanks — external consumers depend on track.name.
          const displayName = deriveTrackDisplayName(track, t.timeline.track);
          const trackBase = {
            id: track.id,
            name: displayName,
            type: kind,
            height: track.height,
            isLocked: track.isLocked,
            isMuted: track.isMuted,
            isVisible: track.isVisible,
            order: track.order,
            items: track.items.map(item => {
              const itemBase = {
                id: item.id,
                name: item.name,
                type: item.type as 'video' | 'audio' | 'subtitle',
                startTime: item.startTime,
                duration: item.duration,
                trackId: item.trackId,
                color: item.color,
                materialId: item.materialId,
                metadata: item.metadata,
                url: item.url,
                serverUrl: item.serverUrl,
                clipStart: item.clipStart,
                clipEnd: item.clipEnd,
                originalDuration: item.originalDuration,
                thumbnailUrl: item.thumbnailUrl,
                waveformData: item.waveformData,
                text: item.text,
                opacity: item.opacity,
                isSelected: item.isSelected,
                originalMaterialType: item.originalMaterialType,
                subtitleStyle: item.subtitleStyle,
                imagePosition: item.imagePosition,
              };
              // Subtitle items do not carry a volume field
              return item.type === 'subtitle'
                ? itemBase
                : { ...itemBase, volume: item.volume };
            }),
          };
          // image- and subtitle-tracks do not carry a volume at rest
          return (kind === 'image' || kind === 'subtitle')
            ? trackBase
            : { ...trackBase, volume: track.volume };
        }),
      } as TimelineData;

      const materialData: MaterialData[] = materials.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        duration: m.duration,
        width: m.width,
        height: m.height,
        thumbnailUrl: m.thumbnailUrl,
        url: m.url,
        serverUrl: m.serverUrl,
        metadata: m.metadata,
      }));

      // Use TimelineRepository to export
      const { blob, filename } = await repository.exportToJSON(
        timelineData,
        materialData,
        {
          exportedAt: new Date().toISOString(),
          version: '1.0.0',
          taskId,
          coverSchemaVersion,
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

      showSuccess(
        t.timeline.messages.exportJsonSuccess.replace('{filename}', filename),
        5000,
      );

      logger.info('时间轴JSON导出成功', {
        fileName: filename,
        trackCount: timelineState.tracks.length
      });

    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : t.timeline.messages.exportUnknownError;
      setExportError(errorMessage);

      showError(
        t.timeline.messages.exportJsonError.replace('{error}', errorMessage),
        8000,
      );

      logger.error('时间轴JSON导出失败', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        trackCount: timelineState?.tracks?.length || 0,
        materialCount: materials?.length || 0
      });

    } finally {
      setIsExporting(false);
      useTimelineStore.getState().setExporting(false);
      exportingRef.current = false;
    }
  }, [taskId, coverSchemaVersion, repository, logger, showSuccess, showError, t]);

  return {
    isExporting,
    exportError,
    exportTimelineToJSON,
    clearError
  };
};
