import { useCallback, useMemo, useState } from 'react';
import { TimelineState, MaterialItem } from '@/types';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { http, ApiError } from '@/lib/api/http-client';
import { VideoEditingLogger } from '../utils/logger';
import { selectAudioPlaybackUrl } from '@/lib/utils/audioUrl';

interface UseVideoExportReturn {
  isExporting: boolean;
  exportProgress: number;
  exportStartTime: number | null;
  handleExport: () => Promise<void>;
}

interface UseVideoExportProps {
  timelineState: TimelineState;
  materials?: MaterialItem[];
  taskId?: string;
  aspectRatio?: string; // Add aspect ratio support (e.g., "16:9", "9:16", "4:3", "1:1", "21:9")
}

/**
 * 计算时间轴中视频轨道的总持续时间
 * @param timelineState 时间轴状态
 * @returns 视频轨道的最大结束时间
 */
const calculateVideoTrackDuration = (timelineState: TimelineState): number => {
  let maxVideoEndTime = 0;
  
  timelineState.tracks.forEach(track => {
    if (track.type === 'video' && track.isVisible && !track.isLocked) {
      track.items.forEach(item => {
        if (item.type === 'video') {
          const itemEndTime = item.startTime + item.duration;
          maxVideoEndTime = Math.max(maxVideoEndTime, itemEndTime);
        }
      });
    }
  });
  
  return maxVideoEndTime;
};

/**
 * 计算时间轴中音频轨道的总持续时间
 * @param timelineState 时间轴状态
 * @returns 音频轨道的最大结束时间
 */
const calculateAudioTrackDuration = (timelineState: TimelineState): number => {
  let maxAudioEndTime = 0;
  
  timelineState.tracks.forEach(track => {
    if (track.type === 'audio' && track.isVisible && !track.isLocked && !track.isMuted) {
      track.items.forEach(item => {
        if (item.type === 'audio') {
          const itemEndTime = item.startTime + item.duration;
          maxAudioEndTime = Math.max(maxAudioEndTime, itemEndTime);
        }
      });
    }
  });
  
  return maxAudioEndTime;
};

/**
 * 验证视频轨道长度是否满足导出要求
 * @param timelineState 时间轴状态
 * @param logger VideoEditingLogger 实例（承载 taskId/component 上下文）
 * @returns 验证结果和详细信息
 */
const validateVideoExport = (timelineState: TimelineState, logger: VideoEditingLogger) => {
  const videoDuration = calculateVideoTrackDuration(timelineState);
  const audioDuration = calculateAudioTrackDuration(timelineState);

  const validationResult = {
    isValid: videoDuration >= audioDuration,
    videoDuration,
    audioDuration,
    deficit: audioDuration > videoDuration ? audioDuration - videoDuration : 0
  };

  logger.info('导出验证结果', {
    isValid: validationResult.isValid,
    videoDuration: videoDuration.toFixed(2),
    audioDuration: audioDuration.toFixed(2),
    deficit: validationResult.deficit.toFixed(2),
    timelineTracksCount: timelineState.tracks.length,
    videoTracksCount: timelineState.tracks.filter(t => t.type === 'video').length,
    audioTracksCount: timelineState.tracks.filter(t => t.type === 'audio').length,
  });

  return validationResult;
};

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
  const [exportStartTime, setExportStartTime] = useState<number | null>(null);
  const { showError, showWarning } = useNotification();
  const { t } = useLocale();

  // Logger is memoized on taskId — stable across renders, safe to include in
  // handleExport's useCallback deps. Replaces 34 raw console.* sites below
  // so production builds emit only warn/error (info/debug are gated in
  // VideoEditingLogger when NODE_ENV==='production' without explicit opt-in
  // via NEXT_PUBLIC_VIDEO_EDIT_DEBUG).
  const logger = useMemo(
    () => new VideoEditingLogger({ component: 'useVideoExport', taskId }),
    [taskId]
  );

  const handleExport = useCallback(async () => {
    logger.info('开始导出处理', {
      totalDuration: timelineState.totalDuration.toFixed(2),
      trackCount: timelineState.tracks.length,
      aspectRatio: aspectRatio || 'default',
      aspectRatioType: typeof aspectRatio,
      aspectRatioLength: aspectRatio?.length,
    });

    // 记录导出开始时间
    const startTime = Date.now();
    setExportStartTime(startTime);
    setIsExporting(true);

    logger.info('导出开始时间记录', {
      startTime: new Date(startTime).toISOString(),
      timestampMs: startTime,
    });

    // 导出前验证
    const validation = validateVideoExport(timelineState, logger);

    if (!validation.isValid) {
      const errorMessage = `${t.videoExport.videoTrackTooShort} ${t.videoExport.videoTrackDuration} ${validation.videoDuration.toFixed(1)}s, ${t.videoExport.audioTrackDuration} ${validation.audioDuration.toFixed(1)}s, ${t.videoExport.needToAdd} ${validation.deficit.toFixed(1)}s`;

      logger.error('导出验证失败', {
        errorMessage,
        videoDuration: validation.videoDuration,
        audioDuration: validation.audioDuration,
        deficit: validation.deficit,
      });

      showError(errorMessage, 6000); // 显示6秒错误提示
      setIsExporting(false);
      setExportProgress(0);
      setExportStartTime(null);
      return;
    }

    logger.info('验证通过，继续导出流程', {
      videoDuration: validation.videoDuration,
      audioDuration: validation.audioDuration,
    });

    // Calculate actual total duration from clipped video segments
    let actualTotalDuration = 0;
    const videoItems: any[] = [];
    const audioItems: any[] = [];
    const subtitleItems: any[] = [];
    const imageItems: any[] = []; // 新增：用于存储图片项目

    // Count audio items the build loop below will attempt to push. Filter must
    // mirror that loop's track guard exactly (visible + unlocked) — muted
    // tracks are still exported with their volume scaled, so they count too.
    // Compared to audioItems.length after the loop so we can hard-fail when
    // materials.find() drops items.
    let expectedAudioItemCount = 0;
    timelineState.tracks.forEach(track => {
      if (track.type !== 'audio' || !track.isVisible || track.isLocked) return;
      track.items.forEach(item => {
        if (item.type === 'audio') expectedAudioItemCount += 1;
      });
    });

    try {
      // Import the video composition API
      const { videoCompositionAPI } = await import('@/lib/api/videoComposition');
      
      // Process each track
      timelineState.tracks.forEach(track => {
        if (!track.isVisible || track.isLocked) {
          logger.debug('跳过轨道', {
            trackId: track.id,
            isVisible: track.isVisible,
            isLocked: track.isLocked,
          });
          return;
        }

        track.items.forEach(item => {
          if (item.type === 'video') {
            // Find the material to get the URL
            const material = materials?.find(m => m.id === item.materialId);
            if (material) {
              // 检查是否为图片材料但在视频轨道中（需要特殊处理）
              if (material.type === 'image' || item.originalMaterialType === 'image') {
                // 这是图片材料，应该作为图片叠加处理，而不是视频处理
                logger.debug('发现图片材料在视频轨道中', {
                  itemId: item.id,
                  itemName: item.name,
                  materialType: material.type,
                  originalMaterialType: item.originalMaterialType,
                  trackId: track.id,
                });

                // 优先使用服务器URL，如果没有则使用本地URL
                const imageUrl = material.serverUrl || material.url;
                
                // 获取图片位置信息，如果没有则使用默认位置
                const imagePosition = item.imagePosition || {
                  x: 0.1,
                  y: 0.1,
                  width: 0.3,
                  height: 0.3,
                  zIndex: 10
                };

                logger.debug('处理图片项目', {
                  itemId: item.id,
                  itemName: item.name,
                  materialUrl: material.url,
                  serverUrl: material.serverUrl,
                  finalUrl: imageUrl,
                  trackId: track.id,
                  position: imagePosition,
                  startTime: item.startTime,
                  duration: item.duration,
                });

                imageItems.push({
                  id: item.id,
                  name: item.name,
                  url: imageUrl,
                  start_time: item.startTime,
                  duration: item.duration,
                  track_id: track.id,
                  position: imagePosition,
                  opacity: item.opacity || 1.0,
                  fade_in_duration: 0.0,
                  fade_out_duration: 0.0
                });
                
                logger.debug('图片项目添加完成', {
                  itemId: item.id,
                  position: imagePosition,
                });
                
                return; // 跳过视频处理逻辑
              }

              // 正常视频处理逻辑
              // 优先使用服务器URL（存储服务URL），如果没有则使用本地URL
              // 这样确保视频合成时后端能够正确下载文件
              const videoUrl = material.serverUrl || material.url;
              
              // Calculate clipped duration for this video item
              const clipStart = item.clipStart || 0;
              const clipEnd = item.clipEnd || (item.originalDuration || item.duration);
              const clippedDuration = clipEnd - clipStart;
              
              logger.debug('处理视频项目', {
                itemId: item.id,
                itemName: item.name,
                materialUrl: material.url,
                serverUrl: material.serverUrl,
                finalUrl: videoUrl,
                trackId: track.id,
                originalDuration: item.originalDuration || item.duration,
                timelineDuration: item.duration,
                clipStart: clipStart,
                clipEnd: clipEnd,
                clippedDuration: clippedDuration,
              });

              // Add clipped duration to actual total
              actualTotalDuration += clippedDuration;

              videoItems.push({
                id: item.id,
                name: item.name,
                url: videoUrl,
                start_time: item.startTime,
                duration: item.duration, // Keep timeline duration for positioning
                track_id: track.id,
                volume: (item.volume ?? 1) * ((track.volume || 100) / 100), // 结合项目音量和轨道音量
                opacity: item.opacity || 1.0,
                // 新增：剪辑信息，用于后端视频裁剪
                clip_start: clipStart,
                clip_end: clipEnd,
                // Add clipped duration for backend reference
                clipped_duration: clippedDuration
              });
              
              logger.debug('视频项目添加完成', {
                itemId: item.id,
                clippedDuration: clippedDuration,
                runningTotalDuration: actualTotalDuration,
              });
            }
          } else if (item.type === 'audio') {
            // Find the material to get the URL
            const material = materials?.find(m => m.id === item.materialId);
            if (material) {
              // iter5: never send a blob: URL to the backend. selectAudioPlaybackUrl
              // returns serverUrl / originalUrl in preference; falls through to
              // material.url only when it is not a blob.
              const resolved = selectAudioPlaybackUrl(material);
              const audioUrl = resolved && !resolved.startsWith('blob:')
                ? resolved
                : (material.serverUrl || '');

              logger.debug('处理音频项目', {
                itemId: item.id,
                itemName: item.name,
                materialUrl: material.url,
                serverUrl: material.serverUrl,
                finalUrl: audioUrl,
                trackId: track.id,
              });

              audioItems.push({
                id: item.id,
                name: item.name,
                url: audioUrl,
                start_time: item.startTime,
                duration: item.duration,
                track_id: track.id,
                volume: (item.volume ?? 1) * ((track.volume || 100) / 100), // 结合项目音量和轨道音量
                // 新增：剪辑信息，用于后端音频裁剪
                clip_start: item.clipStart || 0,
                clip_end: item.clipEnd || (item.originalDuration || item.duration)
              });
              logger.debug('添加音频项目', {
                itemId: item.id,
                itemName: item.name,
                finalUrl: audioUrl,
                trackId: track.id,
                trackVolume: track.volume,
                normalizedVolume: (track.volume || 100) / 100,
                startTime: item.startTime.toFixed(2),
                clipStart: (item.clipStart || 0).toFixed(2),
                clipEnd: (item.clipEnd || (item.originalDuration || item.duration)).toFixed(2),
                clipDuration: ((item.clipEnd || (item.originalDuration || item.duration)) - (item.clipStart || 0)).toFixed(2),
                timelineDuration: item.duration.toFixed(2),
              });
            } else {
              // Track-level miss: a TimelineItem references a material id that
              // is no longer in `materials`. Previously this only emitted a
              // warn and the export silently dropped the audio entry; the
              // count assertion after the loop now turns this into a hard
              // user-visible error.
              logger.error('未找到音频素材对应的URL', {
                materialId: item.materialId,
                itemId: item.id,
                itemName: item.name,
                trackId: track.id,
              });
            }
          } else if (item.type === 'subtitle') {
            // Extract subtitle styling from TimelineItem with proper defaults
            const subtitleStyle = item.subtitleStyle || {
              fontFamily: 'default',
              fontSize: 24, // Use standard default instead of hardcoded 50
              fontColor: '#FFFFFF',
              backgroundColor: '#000000@0.5', // Semi-transparent black background for readability
              position: 'bottom'
            };
            
            logger.debug('处理字幕项目', {
              itemId: item.id,
              itemName: item.name,
              text: item.text || item.name,
              hasSubtitleStyle: !!item.subtitleStyle,
              fontFamily: subtitleStyle.fontFamily,
              fontSize: subtitleStyle.fontSize,
              fontColor: subtitleStyle.fontColor,
              backgroundColor: subtitleStyle.backgroundColor,
              position: subtitleStyle.position,
              startTime: item.startTime,
              duration: item.duration,
            });
            
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

      logger.info('实际总时长计算完成', {
        originalTotalDuration: timelineState.totalDuration,
        actualTotalDuration: actualTotalDuration,
        durationDifference: actualTotalDuration - timelineState.totalDuration,
        videoItemsCount: videoItems.length,
      });

      // Hard-fail when constructed audioItems doesn't match the timeline.
      // This guards the case where `materials.find(m => m.id === item.materialId)`
      // misses (stale state, material not yet loaded, empty url, etc.) and
      // would otherwise silently produce a video without the user's audio.
      if (audioItems.length !== expectedAudioItemCount) {
        const missing = expectedAudioItemCount - audioItems.length;
        const errorMessage =
          `${t.videoExport.exportFailedWithError} ` +
          `audio item mismatch: timeline has ${expectedAudioItemCount} audio item(s) ` +
          `but only ${audioItems.length} were resolvable ` +
          `(${missing} missing material reference${missing === 1 ? '' : 's'}). ` +
          `请刷新页面或重新导入素材后再试。`;

        logger.error('音频项目数量与时间轴不一致，阻止导出', {
          expectedAudioItemCount,
          builtAudioItemCount: audioItems.length,
          missing,
        });

        showError(errorMessage, 8000);
        setIsExporting(false);
        setExportProgress(0);
        setExportStartTime(null);
        return;
      }

      // 关键修改：确保前端按照正确的timeline顺序排序，后端就不需要重新排序
      // 按start_time排序所有项目，确保时间轴顺序正确
      videoItems.sort((a, b) => a.start_time - b.start_time);
      audioItems.sort((a, b) => a.start_time - b.start_time);
      subtitleItems.sort((a, b) => a.start_time - b.start_time);
      imageItems.sort((a, b) => a.start_time - b.start_time); // 对图片项目也进行排序

      logger.debug('完成前端排序', {
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        imageItemsCount: imageItems.length, // 添加图片项目计数
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
        })),
        imageOrder: imageItems.map((item, index) => ({
          index,
          id: item.id,
          name: item.name,
          start_time: item.start_time.toFixed(2),
          track_id: item.track_id
        }))
      });

      // Validate we have content to export
      if (videoItems.length === 0 && audioItems.length === 0 && imageItems.length === 0) {
        logger.warn('没有视频、音频或图片内容可导出', {
          videoItemsCount: videoItems.length,
          audioItemsCount: audioItems.length,
          imageItemsCount: imageItems.length,
        });

        // 使用 toast 警告提示，而不是 alert 弹窗
        showWarning(t.videoExport.noContentToExportFull, 5000);

        logger.debug('No content warning', {
          message: t.videoExport.noContentToExportFull,
        });

        setIsExporting(false);
        setExportProgress(0);
        setExportStartTime(null);
        return;
      }

      // 计算各轨道的最大结束时间用于验证
      const videoEndTimes = videoItems.map(item => item.start_time + item.duration);
      const audioEndTimes = audioItems.map(item => item.start_time + item.duration);
      const imageEndTimes = imageItems.map(item => item.start_time + item.duration); // 计算图片项目的结束时间
      const maxVideoEndTime = videoEndTimes.length > 0 ? Math.max(...videoEndTimes) : 0;
      const maxAudioEndTime = audioEndTimes.length > 0 ? Math.max(...audioEndTimes) : 0;
      const maxImageEndTime = imageEndTimes.length > 0 ? Math.max(...imageEndTimes) : 0; // 获取图片项目的最大结束时间
      const calculatedTotalDuration = Math.max(maxVideoEndTime, maxAudioEndTime, maxImageEndTime); // 计算总时长

      logger.info('准备导出内容', {
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        imageItemsCount: imageItems.length, // 添加图片项目计数
        originalTimelineDuration: timelineState.totalDuration,
        actualClippedDuration: actualTotalDuration,
        calculatedTotalDuration: calculatedTotalDuration,
        maxVideoEndTime: maxVideoEndTime,
        maxAudioEndTime: maxAudioEndTime,
        maxImageEndTime: maxImageEndTime, // 添加图片项目最大结束时间
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
        })),
        imageItems: imageItems.map(item => ({
          id: item.id,
          name: item.name,
          url: item.url,
          start_time: item.start_time,
          duration: item.duration,
          end_time: item.start_time + item.duration,
          position: item.position,
          opacity: item.opacity,
          fade_in_duration: item.fade_in_duration,
          fade_out_duration: item.fade_out_duration
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
        image_items: imageItems, // 添加图片项目到合成请求
        total_duration: actualTotalDuration, // Use actualTotalDuration for composition
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

      logger.debug('合成请求配置', {
        aspectRatio: aspectRatio || 'none',
        hasAspectRatio: !!aspectRatio,
        willUseDefaultResolution: !aspectRatio,
        videoItemsCount: videoItems.length,
        audioItemsCount: audioItems.length,
        subtitleItemsCount: subtitleItems.length,
        imageItemsCount: imageItems.length, // 添加图片项目计数
        totalDuration: actualTotalDuration,
      });

      setExportProgress(20); // 更新进度

      // Show loading state (you might want to add a loading UI here)
      logger.info('发送合成请求', {});
      
      // Start video composition
      const compositionResponse = await videoCompositionAPI.composeVideo(compositionRequest);
      
      if (!compositionResponse.success || !compositionResponse.composition_id) {
        throw new Error(compositionResponse.message || '视频合成请求失败');
      }

      logger.info('合成开始', {
        compositionId: compositionResponse.composition_id,
        status: compositionResponse.status,
      });

      setExportProgress(30); // 更新进度

      // If composition is already completed (unlikely but possible)
      if (compositionResponse.status === 'completed') {
        logger.info('合成立即完成，开始下载', {});
        setExportProgress(100);
        await videoCompositionAPI.triggerDownload(
          compositionResponse.composition_id,
          compositionRequest.task_id,
          `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
        );
        return;
      }

      // Poll for completion and show progress
      logger.info('开始轮询合成状态', {});

      await videoCompositionAPI.pollCompositionStatus(
        compositionResponse.composition_id,
        (status) => {
          const progressPercent = Math.max(30, Math.min(95, 30 + (status.progress * 65)));
          setExportProgress(progressPercent);
          logger.debug('合成进度更新', {
            progress: (status.progress * 100).toFixed(1) + '%',
            displayProgress: progressPercent.toFixed(1) + '%',
            status: status.status,
          });
          // Here you could update a progress UI
        }
      );

      setExportProgress(95); // 设置接近完成的进度

      // Download completed video
      logger.info('合成完成，开始自动下载', {});
      
      try {
        await videoCompositionAPI.triggerDownload(
          compositionResponse.composition_id,
          compositionRequest.task_id,
          `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
        );
      } catch (downloadError: any) {
        logger.error('自动下载失败，尝试 Blob 下载兜底', {
          error: downloadError.message,
        });

        // **Phase 3.8 (2026-04-07) bug fix.** Previously this fallback used
        // `window.open('/api/.../download', '_blank')`, which opens a new
        // tab with a raw browser GET — no Authorization header, so the
        // T01 strict middleware returns 401 and the user sees "无法从网站上
        // 提取文件" with no usable file. The new path uses `http.download`
        // which fetches with auth and triggers a Blob-URL download.
        const downloadUrl = `/api/video-compose/${compositionResponse.composition_id}/download?task_id=${compositionRequest.task_id}`;
        const filename = `video_export_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
        try {
          await http.download(downloadUrl, filename, { timeoutMs: 600_000 });
          logger.info('Blob 兜底下载成功', {});
        } catch (blobError: any) {
          // Both the primary `videoCompositionAPI.triggerDownload` and the
          // Blob fallback have failed. Surface a clear error to the user
          // rather than silently degrading.
          logger.error('Blob 兜底下载也失败', {
            primaryError: downloadError.message,
            blobError: blobError?.message,
          });
          showError(
            `${t.videoExport.exportCompletedButDownloadFailed} ${blobError?.message || ''}`,
            10000,
          );
        }
      }

      setExportProgress(100); // 完成
      logger.info('视频导出完成', {});

    } catch (error: any) {
      // catch (error: unknown)-style narrowing: logger.error has an
      // Error-overload that attaches stack; fall back to data overload
      // when the caught value is not an Error instance.
      if (error instanceof Error) {
        logger.error('导出失败', error);
      } else {
        logger.error('导出失败', { error: String(error) });
      }

      // 检查是否是超时错误并提供更友好的错误信息
      if (error?.name === 'TimeoutError' || error?.message?.includes('timeout')) {
        logger.error('视频导出超时', {
          timeout: '10 minutes',
          error: error.message
        });
        showError(t.videoExport.exportTimeout, 10000);
      } else {
        // Parse error details from ApiError
        let errorMessage = t.videoExport.exportFailed;

        if (error instanceof ApiError) {
          const details = error.details as any;
          if (details?.error_details) {
            const errDetails = details.error_details;
            errorMessage = `${errDetails.error_summary}`;

            if (errDetails.failed_videos && errDetails.failed_videos.length > 0) {
              const failedVideos = errDetails.failed_videos.map((v: any) =>
                `• ${v.video_name} (${v.stage}${t.videoExport.exportFailedWithError}): ${v.error_message}`
              ).join('\n');
              errorMessage += `\n\n${t.videoExport.failedVideos}\n${failedVideos}`;

              if (errDetails.recovery_suggestions && errDetails.recovery_suggestions.length > 0) {
                errorMessage += `\n\n${t.videoExport.recoverySuggestions}\n${errDetails.recovery_suggestions.map((s: string) => `• ${s}`).join('\n')}`;
              }
            }
          } else {
            errorMessage = `${t.videoExport.exportFailedWithError} ${error.message}`;
          }
        } else if (error instanceof Error) {
          errorMessage = `${t.videoExport.exportFailedWithError} ${error.message}`;
        }

        showError(errorMessage, 15000);
      }
    } finally {
      // 重置导出状态
      setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
        setExportStartTime(null);
        
        logger.info('导出状态重置完成', {});
      }, 2000); // 2秒后重置状态
    }
  }, [timelineState, materials, taskId, aspectRatio, showError, showWarning, t, logger]);

  return {
    isExporting,
    exportProgress,
    exportStartTime,
    handleExport
  };
}; 