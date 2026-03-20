/**
 * @deprecated This service has been superseded by TimelineRepository in
 * src/components/video/timeline/infrastructure/TimelineRepository.ts
 * as part of the DDD refactor. This file is kept temporarily for backward
 * compatibility while consumers are migrated. Do NOT add new functionality here.
 */
import { TimelineState, MaterialItem } from '@/types';
import { VideoEditingLogger } from '../utils';

export interface TimelineExportData {
  metadata: {
    exportedAt: string;
    version: string;
    taskId: string;
    totalDuration: number;
    trackCount: number;
    itemCount: number;
  };
  timeline: {
    currentTime: number;
    totalDuration: number;
    zoomLevel: number;
    selectedItems: string[];
    playbackRate: number;
    isPlaying: boolean;
    snapToGrid: boolean;
    gridSize: number;
    scrollLeft: number;
  };
  tracks: Array<{
    id: string;
    name: string;
    type: 'video' | 'audio' | 'subtitle';
    height: number;
    isLocked: boolean;
    isMuted: boolean;
    isVisible: boolean;
    volume: number;
    order: number;
    items: Array<{
      id: string;
      name: string;
      type: 'video' | 'audio' | 'subtitle';
      startTime: number;
      duration: number;
      trackId: string;
      color: string;
      thumbnailUrl?: string;
      waveformData?: number[];
      text?: string;
      materialId?: string;
      volume?: number;
      opacity?: number;
      isSelected?: boolean;
      clipStart?: number;
      clipEnd?: number;
      originalDuration?: number;
      originalMaterialType?: string;
      subtitleStyle?: any;
      imagePosition?: any;
    }>;
  }>;
  materials: Array<{
    id: string;
    name: string;
    type: string;
    format: string;
    size: number;
    duration?: number;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
    url: string;
    serverUrl?: string;
    createdAt: string;
    tags?: string[];
    description?: string;
    metadata?: any;
  }>;
}

export interface TimelineExportRequest {
  taskId: string;
  timelineState: TimelineState;
  materials: MaterialItem[];
}

export interface TimelineExportResponse {
  success: boolean;
  message: string;
  downloadUrl?: string;
  fileName?: string;
  data?: TimelineExportData;
}

export class TimelineExportService {
  private logger: VideoEditingLogger;
  private static readonly API_ENDPOINT = '/api/timeline-export';

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'TimelineExportService'
    });
  }

  /**
   * 处理时间轴数据导出为JSON
   */
  async exportTimelineToJSON(
    taskId: string,
    timelineState: TimelineState,
    materials: MaterialItem[]
  ): Promise<TimelineExportResponse> {
    try {
      this.logger.info('开始导出时间轴数据', {
        taskId,
        trackCount: timelineState.tracks.length,
        materialCount: materials.length,
        totalDuration: timelineState.totalDuration,
        selectedItems: timelineState.selectedItems.length
      });

      // 准备导出数据
      const exportData = this.prepareExportData(taskId, timelineState, materials);

      // 调用API进行导出
      const response = await fetch(TimelineExportService.API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          taskId,
          timelineState,
          materials,
          exportData
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
      }

      const result: TimelineExportResponse = await response.json();

      this.logger.info('时间轴数据导出成功', {
        taskId,
        success: result.success,
        fileName: result.fileName,
        hasDownloadUrl: !!result.downloadUrl
      });

      return result;

    } catch (error) {
      this.logger.error('时间轴数据导出失败', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        message: `导出失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 准备导出数据结构
   */
  private prepareExportData(
    taskId: string,
    timelineState: TimelineState,
    materials: MaterialItem[]
  ): TimelineExportData {
    // 计算总项目数
    const totalItems = timelineState.tracks.reduce((sum, track) => sum + track.items.length, 0);

    const exportData: TimelineExportData = {
      metadata: {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        taskId,
        totalDuration: timelineState.totalDuration,
        trackCount: timelineState.tracks.length,
        itemCount: totalItems
      },
      timeline: {
        currentTime: timelineState.currentTime,
        totalDuration: timelineState.totalDuration,
        zoomLevel: timelineState.zoomLevel,
        selectedItems: [...timelineState.selectedItems],
        playbackRate: timelineState.playbackRate,
        isPlaying: timelineState.isPlaying,
        snapToGrid: timelineState.snapToGrid,
        gridSize: timelineState.gridSize,
        scrollLeft: timelineState.scrollLeft
      },
      tracks: timelineState.tracks.map(track => ({
        id: track.id,
        name: track.name,
        type: track.type,
        height: track.height,
        isLocked: track.isLocked,
        isMuted: track.isMuted,
        isVisible: track.isVisible,
        volume: track.volume,
        order: track.order,
        items: track.items.map(item => ({
          id: item.id,
          name: item.name,
          type: item.type,
          startTime: item.startTime,
          duration: item.duration,
          trackId: item.trackId,
          color: item.color,
          thumbnailUrl: item.thumbnailUrl,
          waveformData: item.waveformData,
          text: item.text,
          materialId: item.materialId,
          volume: item.volume,
          opacity: item.opacity,
          isSelected: item.isSelected,
          clipStart: item.clipStart,
          clipEnd: item.clipEnd,
          originalDuration: item.originalDuration,
          originalMaterialType: item.originalMaterialType,
          subtitleStyle: item.subtitleStyle,
          imagePosition: item.imagePosition
        }))
      })),
      materials: materials.map(material => ({
        id: material.id,
        name: material.name,
        type: material.type,
        format: material.format,
        size: material.size,
        duration: material.duration,
        width: material.width,
        height: material.height,
        thumbnailUrl: material.thumbnailUrl,
        url: material.url,
        serverUrl: material.serverUrl,
        createdAt: material.createdAt.toISOString(),
        tags: material.tags,
        description: material.description,
        metadata: material.metadata
      }))
    };

    this.logger.info('导出数据准备完成', {
      taskId,
      metadataKeys: Object.keys(exportData.metadata),
      trackCount: exportData.tracks.length,
      materialCount: exportData.materials.length,
      timelineKeys: Object.keys(exportData.timeline)
    });

    return exportData;
  }

  /**
   * 下载JSON文件到本地
   */
  downloadJSONFile(data: TimelineExportData, fileName?: string): void {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const defaultFileName = `timeline-export-${data.metadata.taskId}-${new Date().getTime()}.json`;
      const finalFileName = fileName || defaultFileName;

      const link = document.createElement('a');
      link.href = url;
      link.download = finalFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      this.logger.info('JSON文件下载成功', {
        fileName: finalFileName,
        fileSize: jsonString.length,
        taskId: data.metadata.taskId
      });

    } catch (error) {
      this.logger.error('JSON文件下载失败', {
        error: error instanceof Error ? error.message : String(error),
        fileName
      });
      throw error;
    }
  }
}