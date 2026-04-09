'use client';

import { useCallback, useEffect, useRef } from 'react';
import { AIVideoScriptSegment, MaterialItem } from '@/types';
import { createArkVideoTask, getArkVideoStatus } from '@/lib/api/arkVideo';
import { extractVideoThumbnail, extractFrameFromEnd } from '../utils/extractVideoThumbnail';

const POLL_INTERVAL = 5000;

export function useAIVideoScriptGeneration(
  segments: AIVideoScriptSegment[],
  onUpdateSegments: (segments: AIVideoScriptSegment[]) => void,
  onAddMaterial?: (material: MaterialItem) => void,
) {
  const pollTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const updateSegment = useCallback((segmentId: string, updates: Partial<AIVideoScriptSegment>) => {
    const current = segmentsRef.current;
    const updated = current.map(seg =>
      seg.id === segmentId ? { ...seg, ...updates } : seg
    );
    onUpdateSegments(updated);
  }, [onUpdateSegments]);

  const stopPolling = useCallback((segmentId: string) => {
    const timer = pollTimers.current.get(segmentId);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(segmentId);
    }
  }, []);

  const startPolling = useCallback((segmentId: string, arkTaskId: string) => {
    stopPolling(segmentId);

    let simulatedProgress = 10;
    let videoSucceeded = false;
    let ossWaitRetries = 0;
    const MAX_OSS_WAIT_RETRIES = 20;
    const materialId = `ai-video-${segmentId}`;

    const timer = setInterval(async () => {
      try {
        const result = await getArkVideoStatus(arkTaskId);

        if (result.status === 'succeeded' && result.video_url) {
          if (result.thumbnail_url) {
            stopPolling(segmentId);
            updateSegment(segmentId, {
              generationStatus: 'succeeded',
              generationProgress: 100,
              generatedVideoUrl: result.video_url,
              generatedVideoThumbnailUrl: result.thumbnail_url,
              generatedVideoDuration: result.duration,
              generatedVideoWidth: result.width,
              generatedVideoHeight: result.height,
              generationError: undefined,
            });

            if (onAddMaterial) {
              const seg = segmentsRef.current.find(s => s.id === segmentId);
              const material: MaterialItem = {
                id: materialId,
                name: seg?.title || 'AI Generated Video',
                type: 'video',
                format: 'mp4',
                size: 0,
                url: result.video_url,
                serverUrl: result.video_url,
                thumbnailUrl: result.thumbnail_url,
                duration: result.duration,
                width: result.width,
                height: result.height,
                createdAt: new Date(),
                metadata: { source: 'ai-video-script' },
              };
              onAddMaterial(material);
            }
          } else {
            if (!videoSucceeded) {
              videoSucceeded = true;
              updateSegment(segmentId, {
                generationProgress: 95,
              });
              if (onAddMaterial) {
                const seg = segmentsRef.current.find(s => s.id === segmentId);
                const material: MaterialItem = {
                  id: materialId,
                  name: seg?.title || 'AI Generated Video',
                  type: 'video',
                  format: 'mp4',
                  size: 0,
                  url: result.video_url,
                  serverUrl: result.video_url,
                  thumbnailUrl: undefined,
                  duration: result.duration,
                  width: result.width,
                  height: result.height,
                  createdAt: new Date(),
                  metadata: { source: 'ai-video-script' },
                };
                onAddMaterial(material);
              }
            }

            ossWaitRetries++;
            if (ossWaitRetries >= MAX_OSS_WAIT_RETRIES) {
              stopPolling(segmentId);
              updateSegment(segmentId, {
                generationStatus: 'succeeded',
                generationProgress: 100,
                generatedVideoUrl: result.video_url,
                generatedVideoThumbnailUrl: undefined,
                generatedVideoDuration: result.duration,
                generatedVideoWidth: result.width,
                generatedVideoHeight: result.height,
                generationError: undefined,
              });

              extractVideoThumbnail(result.video_url).then(dataUrl => {
                if (dataUrl) {
                  updateSegment(segmentId, {
                    generatedVideoThumbnailUrl: dataUrl,
                  });
                  if (onAddMaterial) {
                    const seg = segmentsRef.current.find(s => s.id === segmentId);
                    onAddMaterial({
                      id: materialId,
                      name: seg?.title || 'AI Generated Video',
                      type: 'video',
                      format: 'mp4',
                      size: 0,
                      url: result.video_url!,
                      serverUrl: result.video_url,
                      thumbnailUrl: dataUrl,
                      duration: result.duration,
                      width: result.width,
                      height: result.height,
                      createdAt: new Date(),
                      metadata: { source: 'ai-video-script' },
                    });
                  }
                }
              });
            }
          }
        } else if (result.status === 'failed') {
          stopPolling(segmentId);
          updateSegment(segmentId, {
            generationStatus: 'failed',
            generationProgress: 0,
            generationError: result.error || 'Video generation failed',
          });
        } else {
          simulatedProgress = Math.min(simulatedProgress + Math.random() * 8, 90);
          updateSegment(segmentId, {
            generationProgress: Math.round(simulatedProgress),
          });
        }
      } catch (error) {
        stopPolling(segmentId);
        updateSegment(segmentId, {
          generationStatus: 'failed',
          generationProgress: 0,
          generationError: error instanceof Error ? error.message : 'Polling failed',
        });
      }
    }, POLL_INTERVAL);

    pollTimers.current.set(segmentId, timer);
  }, [stopPolling, updateSegment, onAddMaterial]);

  const generateVideo = useCallback(async (segmentId: string) => {
    const currentSegments = segmentsRef.current;
    const segIndex = currentSegments.findIndex(s => s.id === segmentId);
    const segment = currentSegments[segIndex];
    if (!segment || !segment.scriptText.trim()) return;

    const mode = segment.generationMode || 'description';

    if (segment.autoTransition && segIndex > 0) {
      const prevSegment = currentSegments[segIndex - 1];
      if (!prevSegment || prevSegment.generationStatus !== 'succeeded' || !prevSegment.generatedVideoUrl) {
        updateSegment(segmentId, {
          generationStatus: 'failed',
          generationProgress: 0,
          generationError: 'Previous video not generated. Please generate the previous scene first.',
        });
        return;
      }

      updateSegment(segmentId, {
        generationStatus: 'generating',
        generationProgress: 3,
        generationError: undefined,
        generatedVideoUrl: undefined,
        generatedVideoThumbnailUrl: undefined,
      });

      try {
        updateSegment(segmentId, { generationProgress: 5 });
        const extractedFrame = await extractFrameFromEnd(prevSegment.generatedVideoUrl, 3);

        if (!extractedFrame) {
          updateSegment(segmentId, {
            generationStatus: 'failed',
            generationProgress: 0,
            generationError: 'Frame extraction failed. Please try again.',
          });
          return;
        }

        updateSegment(segmentId, { generationProgress: 8 });

        const result = await createArkVideoTask({
          prompt: segment.scriptText,
          duration: segment.duration || 5,
          camera_fixed: false,
          watermark: false,
          mode: 'keyframe',
          first_frame_url: extractedFrame,
          resolution: '720p',
        });

        updateSegment(segmentId, {
          arkTaskId: result.ark_task_id,
          generationProgress: 10,
        });

        startPolling(segmentId, result.ark_task_id);
      } catch (error) {
        updateSegment(segmentId, {
          generationStatus: 'failed',
          generationProgress: 0,
          generationError: error instanceof Error ? error.message : 'Failed to create task',
        });
      }
      return;
    }

    if (mode === 'keyframe' && !segment.firstFrameUrl) {
      updateSegment(segmentId, {
        generationStatus: 'failed',
        generationProgress: 0,
        generationError: '请先上传首帧图片',
      });
      return;
    }

    // 参考图模式下，至少需要一张参考图
    if (mode === 'reference' && !segment.referenceImageUrl) {
      updateSegment(segmentId, {
        generationStatus: 'failed',
        generationProgress: 0,
        generationError: '请先上传参考图片',
      });
      return;
    }

    updateSegment(segmentId, {
      generationStatus: 'generating',
      generationProgress: 5,
      generationError: undefined,
      generatedVideoUrl: undefined,
      generatedVideoThumbnailUrl: undefined,
    });

    try {
      // 根据模式构建不同的 API 请求参数
      if (mode === 'keyframe') {
        const result = await createArkVideoTask({
          prompt: segment.scriptText,
          duration: segment.duration || 5,
          camera_fixed: false,
          watermark: false,
          mode: 'keyframe',
          first_frame_url: segment.firstFrameUrl,
          last_frame_url: segment.lastFrameUrl,
          resolution: '720p',
        });

        updateSegment(segmentId, {
          arkTaskId: result.ark_task_id,
          generationProgress: 10,
        });

        startPolling(segmentId, result.ark_task_id);
      } else if (mode === 'reference') {
        // 参考图模式 — 收集参考图片，后端会使用 role="reference_image"
        const imageUrls: string[] = [];
        if (segment.referenceImageUrl) imageUrls.push(segment.referenceImageUrl);
        if (segment.referenceImage2Url) imageUrls.push(segment.referenceImage2Url);

        const result = await createArkVideoTask({
          prompt: segment.scriptText,
          duration: segment.duration || 5,
          camera_fixed: false,
          watermark: false,
          mode: 'reference',
          image_urls: imageUrls.length > 0 ? imageUrls : undefined,
          aspect_ratio: '16:9',
          resolution: '720p',
        });

        updateSegment(segmentId, {
          arkTaskId: result.ark_task_id,
          generationProgress: 10,
        });

        startPolling(segmentId, result.ark_task_id);
      } else {
        // 描述生成模式 — 收集参考图片（首尾帧角色）
        const imageUrls: string[] = [];
        if (segment.characterImageUrl) imageUrls.push(segment.characterImageUrl);
        if (segment.sceneImageUrl) imageUrls.push(segment.sceneImageUrl);

        const result = await createArkVideoTask({
          prompt: segment.scriptText,
          duration: segment.duration || 5,
          camera_fixed: false,
          watermark: false,
          mode: 'description',
          image_urls: imageUrls.length > 0 ? imageUrls : undefined,
          aspect_ratio: '16:9',
          resolution: '720p',
        });

        updateSegment(segmentId, {
          arkTaskId: result.ark_task_id,
          generationProgress: 10,
        });

        startPolling(segmentId, result.ark_task_id);
      }
    } catch (error) {
      updateSegment(segmentId, {
        generationStatus: 'failed',
        generationProgress: 0,
        generationError: error instanceof Error ? error.message : 'Failed to create task',
      });
    }
  }, [updateSegment, startPolling]);

  // Client-side only: stops polling. The Ark API task continues server-side
  // (Ark API does not expose a cancel endpoint).
  const cancelGeneration = useCallback((segmentId: string) => {
    stopPolling(segmentId);
    updateSegment(segmentId, {
      generationStatus: 'idle',
      generationProgress: 0,
      arkTaskId: undefined,
    });
  }, [stopPolling, updateSegment]);

  // Resume polling for any segments that were generating when component mounted
  useEffect(() => {
    for (const segment of segments) {
      if (segment.generationStatus === 'generating' && segment.arkTaskId) {
        if (!pollTimers.current.has(segment.id)) {
          startPolling(segment.id, segment.arkTaskId);
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      pollTimers.current.forEach(timer => clearInterval(timer));
      pollTimers.current.clear();
    };
  }, []);

  return { generateVideo, cancelGeneration };
}
