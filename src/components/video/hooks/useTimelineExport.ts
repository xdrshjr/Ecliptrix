import { useState, useCallback, useMemo } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { TimelineExportService, TimelineExportResponse } from '../services/timelineExportService';
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
 * @param taskId - 任务ID，用于日志记录
 * @returns 时间轴导出相关的状态和方法
 */
export const useTimelineExport = (taskId: string): UseTimelineExportReturn => {
  // 初始化日志器和服务
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useTimelineExport'
  }), [taskId]);

  const exportService = useMemo(() => new TimelineExportService(taskId), [taskId]);
  
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
        totalDuration: timelineState.totalDuration,
        selectedItemsCount: timelineState.selectedItems.length
      });

      // 验证输入数据
      if (!timelineState || !timelineState.tracks) {
        throw new Error('无效的时间轴状态数据');
      }

      if (!Array.isArray(materials)) {
        throw new Error('无效的素材数据');
      }

      // 调用导出服务
      const result: TimelineExportResponse = await exportService.exportTimelineToJSON(
        taskId,
        timelineState,
        materials
      );

      if (!result.success) {
        throw new Error(result.message || '导出失败');
      }

      // 如果返回了数据，直接下载到本地
      if (result.data) {
        exportService.downloadJSONFile(result.data, result.fileName);
        
        showSuccess(`时间轴数据已成功导出为JSON文件: ${result.fileName || '未知文件名'}`, 5000);

        logger.info('时间轴JSON导出成功', {
          fileName: result.fileName,
          trackCount: result.data.tracks.length,
          materialCount: result.data.materials.length,
          totalDuration: result.data.metadata.totalDuration
        });
      } else if (result.downloadUrl) {
        // 如果返回了下载链接，创建下载
        const link = document.createElement('a');
        link.href = result.downloadUrl;
        link.download = result.fileName || `timeline-export-${taskId}-${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showSuccess(`时间轴数据已成功导出，文件正在下载...`, 5000);

        logger.info('时间轴JSON导出成功（下载链接）', {
          downloadUrl: result.downloadUrl,
          fileName: result.fileName
        });
      } else {
        throw new Error('服务器未返回有效的导出数据或下载链接');
      }

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
  }, [taskId, exportService, logger, showSuccess, showError]);

  return {
    isExporting,
    exportError,
    exportTimelineToJSON,
    clearError
  };
};