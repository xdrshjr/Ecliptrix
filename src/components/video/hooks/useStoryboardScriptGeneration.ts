'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StoryboardScriptSegment, StoryboardPack, MaterialItem } from '@/types';
import {
  listPacks,
  getPack,
  describeFrames,
  batchGenerateVideos,
  composeVideo,
} from '@/lib/api/storyboard';
import { getArkVideoStatus } from '@/lib/api/arkVideo';

const POLL_INTERVAL = 5000;

export interface UseStoryboardScriptGenerationProps {
  segments: StoryboardScriptSegment[];
  onUpdateSegments: (segments: StoryboardScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void;
  taskId?: string;
}

export interface UseStoryboardScriptGenerationReturn {
  // Pack management
  availablePacks: StoryboardPack[];
  loadPack: (packId: string) => Promise<void>;
  refreshPacks: () => Promise<void>;
  isLoadingPacks: boolean;
  selectedPackId: string | null;

  // Description generation
  isDescribing: boolean;
  regenerateDescription: (segmentId: string) => Promise<void>;

  // Video generation
  generateVideo: (segmentId: string) => void;
  batchGenerateAllVideos: () => void;
  cancelGeneration: (segmentId: string) => void;

  // Composition
  composeAllVideos: () => Promise<void>;
  isComposing: boolean;
  composedVideoUrl: string | null;
  compositionError: string | null;

  // Computed state
  overallProgress: { completed: number; total: number };
  totalDuration: number;
}

/**
 * Hook for managing storyboard script generation workflow.
 * Modeled after useAIVideoScriptGeneration with additions for:
 * - Pack loading and description generation via VL_LLM
 * - Batch video generation with polling
 * - Video composition
 */
export function useStoryboardScriptGeneration({
  segments,
  onUpdateSegments,
  onAddMaterial,
  taskId,
}: UseStoryboardScriptGenerationProps): UseStoryboardScriptGenerationReturn {
  const [availablePacks, setAvailablePacks] = useState<StoryboardPack[]>([]);
  const [isLoadingPacks, setIsLoadingPacks] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [isDescribing, setIsDescribing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [composedVideoUrl, setComposedVideoUrl] = useState<string | null>(null);
  const [compositionError, setCompositionError] = useState<string | null>(null);

  const pollTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // ── Segment updater (uses ref to avoid stale closures) ──

  const updateSegment = useCallback(
    (segmentId: string, updates: Partial<StoryboardScriptSegment>) => {
      const current = segmentsRef.current;
      const updated = current.map((seg) =>
        seg.id === segmentId ? { ...seg, ...updates } : seg,
      );
      onUpdateSegments(updated);
    },
    [onUpdateSegments],
  );

  // ── Polling helpers ──

  const stopPolling = useCallback((segmentId: string) => {
    const timer = pollTimers.current.get(segmentId);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(segmentId);
    }
  }, []);

  const startPolling = useCallback(
    (segmentId: string, arkTaskId: string) => {
      stopPolling(segmentId);

      let simulatedProgress = 10;

      const timer = setInterval(async () => {
        try {
          // Poll individual ARK task status — same proven pattern as useAIVideoScriptGeneration
          const statusResult = await getArkVideoStatus(arkTaskId);

          if (statusResult.status === 'succeeded' && statusResult.video_url) {
            stopPolling(segmentId);
            updateSegment(segmentId, {
              generationStatus: 'succeeded',
              generationProgress: 100,
              generatedVideoUrl: statusResult.video_url,
              generatedVideoThumbnailUrl: statusResult.thumbnail_url,
              generationError: undefined,
            });

            // Add to materials panel
            if (onAddMaterial) {
              const seg = segmentsRef.current.find(
                (s) => s.id === segmentId,
              );
              const material: MaterialItem = {
                id: `storyboard-video-${segmentId}-${Date.now()}`,
                name: seg
                  ? `分镜 #${seg.frameIndex + 1}`
                  : 'Storyboard Video',
                type: 'video',
                format: 'mp4',
                size: 0,
                url: statusResult.video_url,
                serverUrl: statusResult.video_url,
                thumbnailUrl: statusResult.thumbnail_url,
                duration: statusResult.duration || seg?.duration || 5,
                createdAt: new Date(),
                metadata: { source: 'storyboard-script' },
              };
              onAddMaterial(material);
            }
          } else if (statusResult.status === 'failed') {
            stopPolling(segmentId);
            updateSegment(segmentId, {
              generationStatus: 'failed',
              generationProgress: 0,
              generationError: statusResult.error || '视频生成失败',
            });
          } else {
            // Still running — simulate progress
            simulatedProgress = Math.min(
              simulatedProgress + Math.random() * 8,
              90,
            );
            updateSegment(segmentId, {
              generationProgress: Math.round(simulatedProgress),
            });
          }
        } catch (error) {
          stopPolling(segmentId);
          updateSegment(segmentId, {
            generationStatus: 'failed',
            generationProgress: 0,
            generationError:
              error instanceof Error
                ? error.message
                : '轮询状态失败',
          });
        }
      }, POLL_INTERVAL);

      pollTimers.current.set(segmentId, timer);
    },
    [stopPolling, updateSegment, onAddMaterial],
  );

  // ── Pack management ──

  const refreshPacks = useCallback(async () => {
    setIsLoadingPacks(true);
    try {
      const packs = await listPacks();
      setAvailablePacks(packs);
    } catch (error) {
      console.error('[useStoryboardScriptGeneration] Failed to load packs:', error);
    } finally {
      setIsLoadingPacks(false);
    }
  }, []);

  const loadPack = useCallback(
    async (packId: string) => {
      setSelectedPackId(packId);
      setComposedVideoUrl(null);
      setCompositionError(null);
      setIsDescribing(true);

      try {
        // 1. Fetch pack data
        const pack = await getPack(packId);

        // 2. Create a segment for each frame
        const newSegments: StoryboardScriptSegment[] = pack.frames.map(
          (frame) => ({
            id: `storyboard-seg-${packId}-${frame.index}-${Date.now()}`,
            frameIndex: frame.index,
            frameUrl: frame.url,
            frameThumbnailUrl: frame.url,
            description: frame.description || '',
            duration: 5,
            generationStatus: 'idle' as const,
            generationProgress: 0,
          }),
        );

        onUpdateSegments(newSegments);

        // 3. Auto-generate descriptions via VL_LLM
        try {
          const descriptions = await describeFrames(packId);
          // Merge descriptions into segments
          const withDescriptions = newSegments.map((seg) => {
            const desc = descriptions.find(
              (d) => d.index === seg.frameIndex,
            );
            return desc
              ? { ...seg, description: desc.description }
              : seg;
          });
          onUpdateSegments(withDescriptions);
        } catch (descError) {
          console.error(
            '[useStoryboardScriptGeneration] Failed to generate descriptions:',
            descError,
          );
          // Non-fatal: user can still manually input descriptions
        }
      } catch (error) {
        console.error(
          '[useStoryboardScriptGeneration] Failed to load pack:',
          error,
        );
      } finally {
        setIsDescribing(false);
      }
    },
    [onUpdateSegments],
  );

  // ── Description generation ──

  const regenerateDescription = useCallback(
    async (segmentId: string) => {
      const segment = segmentsRef.current.find(
        (s) => s.id === segmentId,
      );
      if (!segment || !selectedPackId) return;

      setIsDescribing(true);
      try {
        const descriptions = await describeFrames(selectedPackId, [
          segment.frameIndex,
        ]);
        if (descriptions.length > 0) {
          updateSegment(segmentId, {
            description: descriptions[0].description,
          });
        }
      } catch (error) {
        console.error(
          '[useStoryboardScriptGeneration] Failed to regenerate description:',
          error,
        );
      } finally {
        setIsDescribing(false);
      }
    },
    [selectedPackId, updateSegment],
  );

  // ── Single video generation ──

  const generateVideo = useCallback(
    async (segmentId: string) => {
      const segment = segmentsRef.current.find(
        (s) => s.id === segmentId,
      );
      if (!segment || !segment.description.trim() || !selectedPackId)
        return;

      updateSegment(segmentId, {
        generationStatus: 'generating',
        generationProgress: 5,
        generationError: undefined,
        generatedVideoUrl: undefined,
        generatedVideoThumbnailUrl: undefined,
      });

      try {
        const result = await batchGenerateVideos(selectedPackId, [
          {
            frameIndex: segment.frameIndex,
            description: segment.description,
            duration: segment.duration,
          },
        ]);

        if (result.taskIds && result.taskIds.length > 0) {
          updateSegment(segmentId, {
            arkTaskId: result.taskIds[0],
            generationProgress: 10,
          });
          startPolling(segmentId, result.taskIds[0]);
        } else {
          updateSegment(segmentId, {
            generationStatus: 'failed',
            generationProgress: 0,
            generationError: '未获取到任务ID',
          });
        }
      } catch (error) {
        updateSegment(segmentId, {
          generationStatus: 'failed',
          generationProgress: 0,
          generationError:
            error instanceof Error
              ? error.message
              : '创建视频任务失败',
        });
      }
    },
    [selectedPackId, updateSegment, startPolling],
  );

  // ── Batch video generation ──

  const batchGenerateAllVideos = useCallback(async () => {
    if (!selectedPackId) return;

    const idleSegments = segmentsRef.current.filter(
      (s) =>
        (s.generationStatus === 'idle' || s.generationStatus === 'failed') &&
        s.description.trim().length > 0,
    );

    if (idleSegments.length === 0) return;

    // Mark eligible segments as generating
    const idleSegmentIds = new Set(idleSegments.map((s) => s.id));
    const updated = segmentsRef.current.map((seg) => {
      if (idleSegmentIds.has(seg.id)) {
        return {
          ...seg,
          generationStatus: 'generating' as const,
          generationProgress: 5,
          generationError: undefined,
          generatedVideoUrl: undefined,
          generatedVideoThumbnailUrl: undefined,
        };
      }
      return seg;
    });
    onUpdateSegments(updated);

    try {
      const batchPayload = idleSegments.map((seg) => ({
        frameIndex: seg.frameIndex,
        description: seg.description,
        duration: seg.duration,
      }));

      const result = await batchGenerateVideos(
        selectedPackId,
        batchPayload,
      );

      if (result.taskIds && result.taskIds.length > 0) {
        // Update task IDs and start polling for each, staggered to avoid burst requests
        idleSegments.forEach((seg, i) => {
          if (i < result.taskIds.length) {
            updateSegment(seg.id, {
              arkTaskId: result.taskIds[i],
              generationProgress: 10,
            });
            // Stagger polling start: each task offset by 1s to spread load
            setTimeout(() => {
              startPolling(seg.id, result.taskIds[i]);
            }, i * 1000);
          }
        });
      } else {
        // No task IDs — mark all as failed
        idleSegments.forEach((seg) => {
          updateSegment(seg.id, {
            generationStatus: 'failed',
            generationProgress: 0,
            generationError: '批量生成未返回任务ID',
          });
        });
      }
    } catch (error) {
      idleSegments.forEach((seg) => {
        updateSegment(seg.id, {
          generationStatus: 'failed',
          generationProgress: 0,
          generationError:
            error instanceof Error
              ? error.message
              : '批量生成请求失败',
        });
      });
    }
  }, [selectedPackId, onUpdateSegments, updateSegment, startPolling]);

  // ── Cancel generation ──

  const cancelGeneration = useCallback(
    (segmentId: string) => {
      stopPolling(segmentId);
      updateSegment(segmentId, {
        generationStatus: 'idle',
        generationProgress: 0,
        arkTaskId: undefined,
      });
    },
    [stopPolling, updateSegment],
  );

  // ── Video composition ──

  const composeAllVideos = useCallback(async () => {
    if (!selectedPackId) return;

    const allSucceeded = segmentsRef.current.every(
      (s) => s.generationStatus === 'succeeded' && s.generatedVideoUrl,
    );
    if (!allSucceeded) return;

    setIsComposing(true);
    setCompositionError(null);
    setComposedVideoUrl(null);

    try {
      // Collect video URLs in frame order
      const sortedSegments = [...segmentsRef.current].sort(
        (a, b) => a.frameIndex - b.frameIndex,
      );
      const videoUrls = sortedSegments
        .map((s) => s.generatedVideoUrl)
        .filter((url): url is string => Boolean(url));

      const result = await composeVideo(selectedPackId, videoUrls);

      setComposedVideoUrl(result.videoUrl);

      // Add composed video to materials
      if (onAddMaterial && result.videoUrl) {
        const totalDur = sortedSegments.reduce(
          (sum, s) => sum + s.duration,
          0,
        );
        const material: MaterialItem = {
          id: `storyboard-composed-${selectedPackId}-${Date.now()}`,
          name: `分镜合成视频`,
          type: 'video',
          format: 'mp4',
          size: 0,
          url: result.videoUrl,
          serverUrl: result.videoUrl,
          thumbnailUrl: result.videoUrl,
          duration: totalDur,
          createdAt: new Date(),
          metadata: { source: 'storyboard-compose' },
        };
        onAddMaterial(material);
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : '视频合成失败';
      setCompositionError(msg);
      console.error(
        '[useStoryboardScriptGeneration] Composition failed:',
        error,
      );
    } finally {
      setIsComposing(false);
    }
  }, [selectedPackId, onAddMaterial]);

  // ── Computed state ──

  const overallProgress = useMemo(
    () => ({
      completed: segments.filter(
        (s) => s.generationStatus === 'succeeded',
      ).length,
      total: segments.length,
    }),
    [segments],
  );

  const totalDuration = useMemo(
    () => segments.reduce((sum, s) => sum + (s.duration || 5), 0),
    [segments],
  );

  // ── Resume polling on mount for generating segments ──

  useEffect(() => {
    if (!selectedPackId) return;
    for (const segment of segments) {
      if (
        segment.generationStatus === 'generating' &&
        segment.arkTaskId
      ) {
        if (!pollTimers.current.has(segment.id)) {
          startPolling(segment.id, segment.arkTaskId);
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch packs on mount ──

  useEffect(() => {
    refreshPacks();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup timers on unmount ──

  useEffect(() => {
    return () => {
      pollTimers.current.forEach((timer) => clearInterval(timer));
      pollTimers.current.clear();
    };
  }, []);

  return {
    availablePacks,
    loadPack,
    refreshPacks,
    isLoadingPacks,
    selectedPackId,

    isDescribing,
    regenerateDescription,

    generateVideo,
    batchGenerateAllVideos,
    cancelGeneration,

    composeAllVideos,
    isComposing,
    composedVideoUrl,
    compositionError,

    overallProgress,
    totalDuration,
  };
}
