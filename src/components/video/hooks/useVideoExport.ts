import { useCallback, useState } from 'react';
import { TimelineState, MaterialItem } from '@/types';

interface UseVideoExportReturn {
  isExporting: boolean;
  exportProgress: number;
  handleExport: () => Promise<void>;
}

interface UseVideoExportProps {
  timelineState: TimelineState;
  materials?: MaterialItem[];
  taskId?: string;
  aspectRatio?: string; // Add aspect ratio support (e.g., "16:9", "9:16", "4:3", "1:1", "21:9")
}

/**
 * 可复用的视频导出hook
 * 提供视频导出功能，包括状态管理和进度跟踪
 */
export const useVideoExport = ({ 
  timelineState, 
  materials, 
  taskId = 'video_export',
  aspectRatio // Add aspect ratio parameter
}: UseVideoExportProps): UseVideoExportReturn => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const handleExport = useCallback(async () => {
    console.log(`[useVideoExport] 开始导出视频`, {
      totalDuration: timelineState.totalDuration.toFixed(2),
      trackCount: timelineState.tracks.length,
      aspectRatio: aspectRatio || 'default',
      aspectRatioType: typeof aspectRatio,
      aspectRatioLength: aspectRatio?.length,
      taskId,
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

      console.log(`[useVideoExport] 开始处理轨道内容`, {
        totalTracks: timelineState.tracks.length,
        taskId,
        timestamp: new Date().toISOString()
      });

      // Process each track
      timelineState.tracks.forEach(track => {
        if (!track.isVisible || track.isLocked) {
          console.log(`[useVideoExport] 跳过轨道 ${track.id} (不可见或已锁定)`, {
            trackName: track.name,
            isVisible: track.isVisible,
            isLocked: track.isLocked,
            taskId
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
              
              console.log(`[useVideoExport] 处理视频项目`, {
                itemId: item.id,
                itemName: item.name,
                materialUrl: material.url,
                serverUrl: material.serverUrl,
                finalUrl: videoUrl,
                trackId: track.id,
                taskId
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
              console.log(`[useVideoExport] 添加视频项目`, {
                itemId: item.id,
                itemName: item.name,
                finalUrl: videoUrl,
                trackId: track.id,
                startTime: item.startTime.toFixed(2),
                clipStart: (item.clipStart || 0).toFixed(2),
                clipEnd: (item.clipEnd || (item.originalDuration || item.duration)).toFixed(2),
                clipDuration: ((item.clipEnd || (item.originalDuration || item.duration)) - (item.clipStart || 0)).toFixed(2),
                timelineDuration: item.duration.toFixed(2),
                taskId
              });
            } else {
              console.warn(`[useVideoExport] 未找到素材 ${item.materialId} 对应的URL`, { taskId });
            }
          } else if (item.type === 'audio') {
            // Find the material to get the URL
            const material = materials?.find(m => m.id === item.materialId);
            if (material) {
              // 优先使用服务器URL，如果没有则使用普通URL
              const audioUrl = material.serverUrl || material.url;
              
              console.log(`[useVideoExport] 处理音频项目`, {
                itemId: item.id,
                itemName: item.name,
                materialUrl: material.url,
                serverUrl: material.serverUrl,
                finalUrl: audioUrl,
                trackId: track.id,
                taskId
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
              console.log(`[useVideoExport] 添加音频项目`, {
                itemId: item.id,
                itemName: item.name,
                finalUrl: audioUrl,
                trackId: track.id,
                startTime: item.startTime.toFixed(2),
                clipStart: (item.clipStart || 0).toFixed(2),
                clipEnd: (item.clipEnd || (item.originalDuration || item.duration)).toFixed(2),
                clipDuration: ((item.clipEnd || (item.originalDuration || item.duration)) - (item.clipStart || 0)).toFixed(2),
                timelineDuration: item.duration.toFixed(2),
                taskId
              });
            } else {
              console.warn(`[useVideoExport] 未找到音频素材 ${item.materialId} 对应的URL`, { taskId });
            }
          } else if (item.type === 'subtitle') {
            // Extract subtitle styling from TimelineItem
            const subtitleStyle = item.subtitleStyle || {
              fontFamily: 'default',
              fontSize: 24,
              fontColor: '#FFFFFF',
              position: 'bottom'
            };
            
            subtitleItems.push({
              id: item.id,
              name: item.name,
              text: item.text || item.name, // Use text if available, otherwise use name
              start_time: item.startTime,
              duration: item.duration,
              track_id: track.id,
              font_family: subtitleStyle.fontFamily,
              font_size: subtitleStyle.fontSize,
              font_color: subtitleStyle.fontColor,
              background_color: subtitleStyle.backgroundColor,
              position: subtitleStyle.position
            });
          }
        });
      });

      // 关键修改：确保前端按照正确的timeline顺序排序，后端就不需要重新排序
      // 按start_time排序所有项目，确保时间轴顺序正确
      videoItems.sort((a, b) => a.start_time - b.start_time);
      audioItems.sort((a, b) => a.start_time - b.start_time);
      subtitleItems.sort((a, b) => a.start_time - b.start_time);

      console.log(`[useVideoExport] 完成前端排序`, {
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        taskId,
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
        console.warn(`[useVideoExport] 没有视频内容可导出`, { taskId });
        alert('没有视频内容可导出，请先添加视频素材到时间轴');
        return;
      }

      // 计算各轨道的最大结束时间用于验证
      const videoEndTimes = videoItems.map(item => item.start_time + item.duration);
      const audioEndTimes = audioItems.map(item => item.start_time + item.duration);
      const maxVideoEndTime = videoEndTimes.length > 0 ? Math.max(...videoEndTimes) : 0;
      const maxAudioEndTime = audioEndTimes.length > 0 ? Math.max(...audioEndTimes) : 0;
      const calculatedTotalDuration = Math.max(maxVideoEndTime, maxAudioEndTime);

      console.log(`[useVideoExport] 准备导出内容`, {
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        totalDuration: timelineState.totalDuration,
        calculatedTotalDuration: calculatedTotalDuration,
        maxVideoEndTime: maxVideoEndTime,
        maxAudioEndTime: maxAudioEndTime,
        durationMatch: Math.abs(timelineState.totalDuration - calculatedTotalDuration) < 0.1,
        taskId,
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
        task_id: `export_${taskId}_${Date.now()}`, // Generate a unique task ID
        aspect_ratio: aspectRatio, // Include selected aspect ratio
        video_items: videoItems,
        audio_items: audioItems,
        subtitle_items: subtitleItems,
        total_duration: timelineState.totalDuration,
        // Only include output_resolution if no aspect_ratio is specified (let backend calculate resolution from aspect ratio)
        ...(aspectRatio ? {} : {
          output_resolution: {
            width: 1920,
            height: 1080
          }
        }),
        output_fps: 30,
        output_format: 'mp4'
      };

      console.log(`[useVideoExport] 合成请求配置`, {
        taskId,
        aspectRatio: aspectRatio || 'none',
        hasAspectRatio: !!aspectRatio,
        willUseDefaultResolution: !aspectRatio,
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        totalDuration: timelineState.totalDuration,
        timestamp: new Date().toISOString()
      });

      setExportProgress(20); // 更新进度

      // Show loading state (you might want to add a loading UI here)
      console.log(`[useVideoExport] 发送合成请求...`, { taskId });
      
      // Start video composition
      const compositionResponse = await videoCompositionAPI.composeVideo(compositionRequest);
      
      if (!compositionResponse.success || !compositionResponse.composition_id) {
        throw new Error(compositionResponse.message || '视频合成请求失败');
      }

      console.log(`[useVideoExport] 合成开始`, {
        compositionId: compositionResponse.composition_id,
        status: compositionResponse.status,
        taskId
      });

      setExportProgress(30); // 更新进度

      // If composition is already completed (unlikely but possible)
      if (compositionResponse.status === 'completed') {
        console.log(`[useVideoExport] 合成立即完成，开始下载`, { taskId });
        setExportProgress(100);
        await videoCompositionAPI.triggerDownload(
          compositionResponse.composition_id,
          compositionRequest.task_id,
          `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
        );
        return;
      }

      // Poll for completion and show progress
      console.log(`[useVideoExport] 开始轮询合成状态...`, { taskId });
      
      await videoCompositionAPI.pollCompositionStatus(
        compositionResponse.composition_id,
        (status) => {
          const progressPercent = Math.max(30, Math.min(95, 30 + (status.progress * 65)));
          setExportProgress(progressPercent);
          console.log(`[useVideoExport] 合成进度更新`, {
            progress: (status.progress * 100).toFixed(1) + '%',
            displayProgress: progressPercent.toFixed(1) + '%',
            status: status.status,
            taskId
          });
          // Here you could update a progress UI
        }
      );

      setExportProgress(95); // 设置接近完成的进度

      // Download completed video
      console.log(`[useVideoExport] 合成完成，开始自动下载...`, { taskId });
      await videoCompositionAPI.triggerDownload(
        compositionResponse.composition_id,
        compositionRequest.task_id,
        `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
      );

      setExportProgress(100); // 完成
      console.log(`[useVideoExport] 视频导出完成`, { taskId });
      
    } catch (error) {
      console.error(`[useVideoExport] 导出失败`, { error, taskId });
      alert(`视频导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      // 重置导出状态
      setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
      }, 2000); // 2秒后重置状态
    }
  }, [timelineState, materials, taskId, aspectRatio]);

  return {
    isExporting,
    exportProgress,
    handleExport
  };
}; 