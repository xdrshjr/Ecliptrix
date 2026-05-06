'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StoryboardScriptSegment, StoryboardPack, StoryboardVideoCandidate, MaterialItem } from '@/types';
import {
  listPacks,
  getPack,
  describeFrames,
  batchGenerateVideos,
  composeVideo,
} from '@/lib/api/storyboard';
import { getArkVideoStatus } from '@/lib/api/arkVideo';
import {
  PLACEHOLDER_VIDEO_THUMBNAIL,
  resolveStoryboardThumbnail,
} from '../utils/storyboardThumbnail';

const POLL_INTERVAL = 5000;

export interface UseStoryboardScriptGenerationProps {
  segments: StoryboardScriptSegment[];
  onUpdateSegments: (segments: StoryboardScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void;
  taskId?: string;
  /** Owning project id — required for ``listPacks``. Without it the
   *  available-packs list stays empty rather than 400-ing the backend. */
  projectId?: string;
}

export interface UseStoryboardScriptGenerationReturn {
  // Pack management
  availablePacks: StoryboardPack[];
  loadPack: (packId: string) => Promise<void>;
  refreshPacks: () => Promise<void>;
  isLoadingPacks: boolean;
  isLoadingPack: boolean;
  selectedPackId: string | null;

  // Description generation
  isDescribing: boolean;
  generateAllDescriptions: () => Promise<void>;
  regenerateDescription: (segmentId: string) => Promise<void>;

  // Video generation
  generateVideo: (segmentId: string) => void;
  generateMultipleVideos: (segmentId: string, count: number) => void;
  batchGenerateAllVideos: (repeat?: number) => void;
  cancelGeneration: (segmentId: string) => void;
  selectCandidate: (segmentId: string, candidateId: string) => void;

  // Composition
  composeAllVideos: () => Promise<void>;
  isComposing: boolean;
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
 * - Multi-video candidate generation and selection
 * - Video composition
 */
export function useStoryboardScriptGeneration({
  segments,
  onUpdateSegments,
  onAddMaterial,
  taskId,
  projectId,
}: UseStoryboardScriptGenerationProps): UseStoryboardScriptGenerationReturn {
  const [availablePacks, setAvailablePacks] = useState<StoryboardPack[]>([]);
  const [isLoadingPacks, setIsLoadingPacks] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [isDescribing, setIsDescribing] = useState(false);

  useEffect(() => {
    if (!selectedPackId && segments.length > 0) {
      const derived = segments[0].packId;
      if (derived) {
        setSelectedPackId(derived);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [isLoadingPack, setIsLoadingPack] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [compositionError, setCompositionError] = useState<string | null>(null);

  // Key can be segmentId (single video) or candidateId (multi-video)
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

  const stopPolling = useCallback((key: string) => {
    const timer = pollTimers.current.get(key);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(key);
    }
  }, []);

  const startPolling = useCallback(
    (segmentId: string, arkTaskId: string) => {
      stopPolling(segmentId);

      let simulatedProgress = 10;
      let videoSucceeded = false;
      let ossWaitRetries = 0;
      const MAX_OSS_WAIT_RETRIES = 20;
      const materialId = `storyboard-video-${segmentId}`;

      const timer = setInterval(async () => {
        try {
          const statusResult = await getArkVideoStatus(arkTaskId);

          if (statusResult.status === 'queued') {
            updateSegment(segmentId, {
              generationStatus: 'queued',
              generationProgress: 0,
              queuePosition: statusResult.position_in_queue,
            });
            return;
          }

          if (statusResult.status === 'timeout') {
            stopPolling(segmentId);
            updateSegment(segmentId, {
              generationStatus: 'timeout',
              generationProgress: 0,
              queuePosition: undefined,
              generationError: statusResult.error || '生成超时',
            });
            return;
          }

          // Normalize: once we see any non-queued state, flip to generating for progress UI.
          if (statusResult.status === 'running') {
            updateSegment(segmentId, {
              generationStatus: 'generating',
              queuePosition: undefined,
            });
          }

          if (statusResult.status === 'succeeded' && statusResult.video_url) {
            if (statusResult.thumbnail_url) {
              stopPolling(segmentId);
              updateSegment(segmentId, {
                generationStatus: 'succeeded',
                generationProgress: 100,
                generatedVideoUrl: statusResult.video_url,
                generatedVideoThumbnailUrl: statusResult.thumbnail_url,
                generationError: undefined,
              });

              if (onAddMaterial) {
                const seg = segmentsRef.current.find((s) => s.id === segmentId);
                const material: MaterialItem = {
                  id: materialId,
                  name: seg ? `分镜 #${seg.frameIndex + 1}` : 'Storyboard Video',
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
            } else {
              if (!videoSucceeded) {
                videoSucceeded = true;
                updateSegment(segmentId, { generationProgress: 95 });
                if (onAddMaterial) {
                  const seg = segmentsRef.current.find((s) => s.id === segmentId);
                  const material: MaterialItem = {
                    id: materialId,
                    name: seg ? `分镜 #${seg.frameIndex + 1}` : 'Storyboard Video',
                    type: 'video',
                    format: 'mp4',
                    size: 0,
                    url: statusResult.video_url,
                    serverUrl: statusResult.video_url,
                    thumbnailUrl: PLACEHOLDER_VIDEO_THUMBNAIL,
                    duration: statusResult.duration || seg?.duration || 5,
                    createdAt: new Date(),
                    metadata: { source: 'storyboard-script' },
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
                  generatedVideoUrl: statusResult.video_url,
                  generatedVideoThumbnailUrl: PLACEHOLDER_VIDEO_THUMBNAIL,
                  generationError: undefined,
                });

                const segAtMax = segmentsRef.current.find((s) => s.id === segmentId);
                resolveStoryboardThumbnail(
                  statusResult.video_url,
                  segAtMax?.frameThumbnailUrl || segAtMax?.frameUrl,
                ).then((finalThumb) => {
                  updateSegment(segmentId, {
                    generatedVideoThumbnailUrl: finalThumb,
                  });
                  if (onAddMaterial) {
                    const seg = segmentsRef.current.find((s) => s.id === segmentId);
                    onAddMaterial({
                      id: materialId,
                      name: seg ? `分镜 #${seg.frameIndex + 1}` : 'Storyboard Video',
                      type: 'video',
                      format: 'mp4',
                      size: 0,
                      url: statusResult.video_url!,
                      serverUrl: statusResult.video_url,
                      thumbnailUrl: finalThumb,
                      duration: statusResult.duration || seg?.duration || 5,
                      createdAt: new Date(),
                      metadata: { source: 'storyboard-script' },
                    });
                  }
                });
              }
            }
          } else if (statusResult.status === 'failed') {
            stopPolling(segmentId);
            updateSegment(segmentId, {
              generationStatus: 'failed',
              generationProgress: 0,
              generationError: statusResult.error || '视频生成失败',
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
            generationError: error instanceof Error ? error.message : '轮询状态失败',
          });
        }
      }, POLL_INTERVAL);

      pollTimers.current.set(segmentId, timer);
    },
    [stopPolling, updateSegment, onAddMaterial],
  );

  /** Start polling for a candidate video within a multi-video segment */
  const startCandidatePolling = useCallback(
    (segmentId: string, candidateId: string, arkTaskId: string) => {
      stopPolling(candidateId);

      let simulatedProgress = 10;
      let ossWaitRetries = 0;
      const MAX_OSS_WAIT_RETRIES = 20;
      const materialId = `storyboard-video-${candidateId}`;

      const timer = setInterval(async () => {
        try {
          const statusResult = await getArkVideoStatus(arkTaskId);

          const segment = segmentsRef.current.find(s => s.id === segmentId);
          if (!segment?.videoCandidates) {
            stopPolling(candidateId);
            return;
          }

          if (statusResult.status === 'queued') {
            const updatedCandidates = segment.videoCandidates.map(c =>
              c.id === candidateId
                ? { ...c, status: 'queued' as const, progress: 0, queuePosition: statusResult.position_in_queue }
                : c,
            );
            updateSegment(segmentId, { videoCandidates: updatedCandidates });
            return;
          }

          if (statusResult.status === 'timeout') {
            stopPolling(candidateId);
            const updatedCandidates = segment.videoCandidates.map(c =>
              c.id === candidateId
                ? { ...c, status: 'timeout' as const, progress: 0, error: statusResult.error || '生成超时' }
                : c,
            );
            const allDone = updatedCandidates.every(c => c.status === 'succeeded' || c.status === 'failed' || c.status === 'timeout');
            const anySucceeded = updatedCandidates.some(c => c.status === 'succeeded');
            const firstSucceeded = updatedCandidates.find(c => c.status === 'succeeded');
            const segmentUpdates: Partial<StoryboardScriptSegment> = { videoCandidates: updatedCandidates };
            if (allDone) {
              segmentUpdates.generationStatus = anySucceeded ? 'succeeded' : 'failed';
              if (anySucceeded && !segment.selectedCandidateId) {
                segmentUpdates.selectedCandidateId = firstSucceeded!.id;
                segmentUpdates.generatedVideoUrl = firstSucceeded!.videoUrl;
                segmentUpdates.generatedVideoThumbnailUrl = firstSucceeded!.thumbnailUrl;
              }
            }
            updateSegment(segmentId, segmentUpdates);
            return;
          }

          if (statusResult.status === 'running') {
            const updatedCandidates = segment.videoCandidates.map(c =>
              c.id === candidateId && c.status !== 'succeeded' && c.status !== 'failed'
                ? { ...c, status: 'generating' as const, queuePosition: undefined }
                : c,
            );
            updateSegment(segmentId, { videoCandidates: updatedCandidates });
          }

          if (statusResult.status === 'succeeded' && statusResult.video_url && statusResult.thumbnail_url) {
            stopPolling(candidateId);

            const updatedCandidates = segment.videoCandidates.map(c => {
              if (c.id !== candidateId) return c;
              return { ...c, status: 'succeeded' as const, progress: 100, videoUrl: statusResult.video_url, thumbnailUrl: statusResult.thumbnail_url };
            });

            const allDone = updatedCandidates.every(c => c.status === 'succeeded' || c.status === 'failed' || c.status === 'timeout');
            const anySucceeded = updatedCandidates.some(c => c.status === 'succeeded');
            const firstSucceeded = updatedCandidates.find(c => c.status === 'succeeded');

            const segmentUpdates: Partial<StoryboardScriptSegment> = {
              videoCandidates: updatedCandidates,
            };

            if (allDone) {
              segmentUpdates.generationStatus = anySucceeded ? 'succeeded' : 'failed';
              segmentUpdates.generationProgress = 100;
              if (anySucceeded && !segment.selectedCandidateId) {
                segmentUpdates.selectedCandidateId = firstSucceeded!.id;
                segmentUpdates.generatedVideoUrl = firstSucceeded!.videoUrl;
                segmentUpdates.generatedVideoThumbnailUrl = firstSucceeded!.thumbnailUrl;
              }
            } else {
              const avgProgress = updatedCandidates.reduce((sum, c) => sum + c.progress, 0) / updatedCandidates.length;
              segmentUpdates.generationProgress = Math.round(avgProgress);
            }

            updateSegment(segmentId, segmentUpdates);

            if (onAddMaterial) {
              const material: MaterialItem = {
                id: materialId,
                name: segment ? `分镜 #${segment.frameIndex + 1} 候选` : 'Storyboard Video',
                type: 'video',
                format: 'mp4',
                size: 0,
                url: statusResult.video_url,
                serverUrl: statusResult.video_url,
                thumbnailUrl: statusResult.thumbnail_url,
                duration: statusResult.duration || segment?.duration || 5,
                createdAt: new Date(),
                metadata: { source: 'storyboard-script', candidateId },
              };
              onAddMaterial(material);
            }
          } else if (statusResult.status === 'succeeded' && statusResult.video_url) {
            ossWaitRetries++;

            if (ossWaitRetries >= MAX_OSS_WAIT_RETRIES) {
              stopPolling(candidateId);

              const updatedCandidates = segment.videoCandidates.map(c => {
                if (c.id !== candidateId) return c;
                return { ...c, status: 'succeeded' as const, progress: 100, videoUrl: statusResult.video_url, thumbnailUrl: PLACEHOLDER_VIDEO_THUMBNAIL };
              });

              const allDone = updatedCandidates.every(c => c.status === 'succeeded' || c.status === 'failed' || c.status === 'timeout');
              const anySucceeded = updatedCandidates.some(c => c.status === 'succeeded');
              const firstSucceeded = updatedCandidates.find(c => c.status === 'succeeded');

              const segmentUpdates: Partial<StoryboardScriptSegment> = {
                videoCandidates: updatedCandidates,
              };

              if (allDone) {
                segmentUpdates.generationStatus = anySucceeded ? 'succeeded' : 'failed';
                segmentUpdates.generationProgress = 100;
                if (anySucceeded && !segment.selectedCandidateId) {
                  segmentUpdates.selectedCandidateId = firstSucceeded!.id;
                  segmentUpdates.generatedVideoUrl = firstSucceeded!.videoUrl;
                  segmentUpdates.generatedVideoThumbnailUrl = firstSucceeded!.thumbnailUrl;
                }
              }

              updateSegment(segmentId, segmentUpdates);

              if (onAddMaterial) {
                const material: MaterialItem = {
                  id: materialId,
                  name: segment ? `分镜 #${segment.frameIndex + 1} 候选` : 'Storyboard Video',
                  type: 'video',
                  format: 'mp4',
                  size: 0,
                  url: statusResult.video_url,
                  serverUrl: statusResult.video_url,
                  thumbnailUrl: PLACEHOLDER_VIDEO_THUMBNAIL,
                  duration: statusResult.duration || segment?.duration || 5,
                  createdAt: new Date(),
                  metadata: { source: 'storyboard-script', candidateId },
                };
                onAddMaterial(material);
              }

              resolveStoryboardThumbnail(
                statusResult.video_url,
                segment?.frameThumbnailUrl || segment?.frameUrl,
              ).then(finalThumb => {
                if (onAddMaterial) {
                  onAddMaterial({
                    id: materialId,
                    name: segment ? `分镜 #${segment.frameIndex + 1} 候选` : 'Storyboard Video',
                    type: 'video',
                    format: 'mp4',
                    size: 0,
                    url: statusResult.video_url!,
                    serverUrl: statusResult.video_url,
                    thumbnailUrl: finalThumb,
                    duration: statusResult.duration || segment?.duration || 5,
                    createdAt: new Date(),
                    metadata: { source: 'storyboard-script', candidateId },
                  });
                }
              });
            } else {
              const updatedCandidates = segment.videoCandidates.map(c => {
                if (c.id !== candidateId) return c;
                return { ...c, progress: 95, videoUrl: statusResult.video_url };
              });
              const avgProgress = updatedCandidates.reduce((sum, c) => sum + c.progress, 0) / updatedCandidates.length;
              updateSegment(segmentId, {
                videoCandidates: updatedCandidates,
                generationProgress: Math.round(avgProgress),
              });
            }
          } else if (statusResult.status === 'failed') {
            stopPolling(candidateId);
            const updatedCandidates = segment.videoCandidates.map(c =>
              c.id === candidateId ? { ...c, status: 'failed' as const, progress: 0, error: statusResult.error || '视频生成失败' } : c,
            );
            const allDone = updatedCandidates.every(c => c.status === 'succeeded' || c.status === 'failed' || c.status === 'timeout');
            const anySucceeded = updatedCandidates.some(c => c.status === 'succeeded');
            const firstSucceeded = updatedCandidates.find(c => c.status === 'succeeded');

            const segmentUpdates: Partial<StoryboardScriptSegment> = { videoCandidates: updatedCandidates };
            if (allDone) {
              segmentUpdates.generationStatus = anySucceeded ? 'succeeded' : 'failed';
              if (anySucceeded && !segment.selectedCandidateId) {
                segmentUpdates.selectedCandidateId = firstSucceeded!.id;
                segmentUpdates.generatedVideoUrl = firstSucceeded!.videoUrl;
                segmentUpdates.generatedVideoThumbnailUrl = firstSucceeded!.thumbnailUrl;
              }
            }
            updateSegment(segmentId, segmentUpdates);
          } else {
            simulatedProgress = Math.min(simulatedProgress + Math.random() * 8, 90);
            const updatedCandidates = segment.videoCandidates.map(c => {
              if (c.id !== candidateId) return c;
              return { ...c, progress: Math.round(simulatedProgress) };
            });
            const avgProgress = updatedCandidates.reduce((sum, c) => sum + c.progress, 0) / updatedCandidates.length;
            updateSegment(segmentId, {
              videoCandidates: updatedCandidates,
              generationProgress: Math.round(avgProgress),
            });
          }
        } catch (error) {
          stopPolling(candidateId);
          const segment = segmentsRef.current.find(s => s.id === segmentId);
          if (segment?.videoCandidates) {
            const updatedCandidates = segment.videoCandidates.map(c =>
              c.id === candidateId ? { ...c, status: 'failed' as const, progress: 0, error: error instanceof Error ? error.message : '轮询状态失败' } : c,
            );
            const allDone = updatedCandidates.every(c => c.status === 'succeeded' || c.status === 'failed' || c.status === 'timeout');
            const anySucceeded = updatedCandidates.some(c => c.status === 'succeeded');
            const firstSucceeded = updatedCandidates.find(c => c.status === 'succeeded');

            const segmentUpdates: Partial<StoryboardScriptSegment> = { videoCandidates: updatedCandidates };
            if (allDone) {
              segmentUpdates.generationStatus = anySucceeded ? 'succeeded' : 'failed';
              if (anySucceeded && !segment.selectedCandidateId) {
                segmentUpdates.selectedCandidateId = firstSucceeded!.id;
                segmentUpdates.generatedVideoUrl = firstSucceeded!.videoUrl;
                segmentUpdates.generatedVideoThumbnailUrl = firstSucceeded!.thumbnailUrl;
              }
            }
            updateSegment(segmentId, segmentUpdates);
          }
        }
      }, POLL_INTERVAL);

      pollTimers.current.set(candidateId, timer);
    },
    [stopPolling, updateSegment, onAddMaterial],
  );

  // ── Pack management ──

  const refreshPacks = useCallback(async () => {
    if (!projectId) {
      setAvailablePacks([]);
      return;
    }
    setIsLoadingPacks(true);
    try {
      const packs = await listPacks(projectId);
      setAvailablePacks(packs);
    } catch (error) {
      console.error('[useStoryboardScriptGeneration] Failed to load packs:', error);
    } finally {
      setIsLoadingPacks(false);
    }
  }, [projectId]);

  const loadPack = useCallback(
    async (packId: string) => {
      setSelectedPackId(packId);
      setCompositionError(null);
      setIsLoadingPack(true);

      if (!projectId) {
        console.warn('[useStoryboardScriptGeneration] loadPack called without projectId; skipping fetch');
        setIsLoadingPack(false);
        return;
      }
      try {
        // 1. Fetch pack data
        const pack = await getPack(projectId, packId);

        // 2. Pack-level binding decision: if every frame has a non-empty script,
        //    treat the whole pack as script-bound — inject scripts into segment
        //    descriptions and flag boundFromPack so downstream skips VL_LLM.
        //    Otherwise fall back to existing description or empty string and
        //    let the VL describe path handle it.
        const packIsScripted =
          pack.frames.length > 0 &&
          pack.frames.every((f) => (f.script || '').trim().length > 0);

        const newSegments: StoryboardScriptSegment[] = pack.frames.map(
          (frame) => {
            const boundScript = (frame.script || '').trim();
            const description = packIsScripted
              ? boundScript
              : (frame.description || '');
            return {
              id: `storyboard-seg-${packId}-${frame.index}-${Date.now()}`,
              packId,
              frameIndex: frame.index,
              frameUrl: frame.url,
              frameThumbnailUrl: frame.url,
              description,
              duration: 5,
              generationStatus: 'idle' as const,
              generationProgress: 0,
              boundFromPack: packIsScripted,
            };
          },
        );

        onUpdateSegments(newSegments);
      } catch (error) {
        console.error(
          '[useStoryboardScriptGeneration] Failed to load pack:',
          error,
        );
      } finally {
        setIsLoadingPack(false);
      }
    },
    [onUpdateSegments, projectId],
  );

  // ── Description generation ──

  const generateAllDescriptions = useCallback(async () => {
    if (!selectedPackId) return;
    setIsDescribing(true);
    try {
      const descriptions = await describeFrames(selectedPackId);
      const current = segmentsRef.current;
      const updated = current.map((seg) => {
        const desc = descriptions.find((d) => d.index === seg.frameIndex);
        return desc ? { ...seg, description: desc.description } : seg;
      });
      onUpdateSegments(updated);
    } catch (error) {
      console.error(
        '[useStoryboardScriptGeneration] Failed to generate descriptions:',
        error,
      );
    } finally {
      setIsDescribing(false);
    }
  }, [selectedPackId, onUpdateSegments]);

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
        generationStatus: 'queued',
        generationProgress: 0,
        generationError: undefined,
        generatedVideoUrl: undefined,
        generatedVideoThumbnailUrl: undefined,
        videoCandidates: undefined,
        selectedCandidateId: undefined,
        queuePosition: undefined,
      });

      try {
        const result = await batchGenerateVideos(selectedPackId, [
          {
            frameIndex: segment.frameIndex,
            description: segment.description,
            duration: segment.duration,
          },
        ]);

        const group = result.taskGroups.find(g => g.frameIndex === segment.frameIndex);
        if (group && group.taskIds.length > 0) {
          updateSegment(segmentId, {
            arkTaskId: group.taskIds[0],
          });
          startPolling(segmentId, group.taskIds[0]);
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

  // ── Multi-video generation ──

  const generateMultipleVideos = useCallback(
    async (segmentId: string, count: number) => {
      const segment = segmentsRef.current.find(
        (s) => s.id === segmentId,
      );
      if (!segment || !segment.description.trim() || !selectedPackId)
        return;

      // Initialize candidates
      const candidates: StoryboardVideoCandidate[] = Array.from({ length: count }, (_, i) => ({
        id: `candidate-${segmentId}-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        arkTaskId: '',
        status: 'queued' as const,
        progress: 0,
      }));

      updateSegment(segmentId, {
        generationStatus: 'queued',
        generationProgress: 0,
        generationError: undefined,
        generatedVideoUrl: undefined,
        generatedVideoThumbnailUrl: undefined,
        videoCandidates: candidates,
        selectedCandidateId: undefined,
      });

      try {
        const result = await batchGenerateVideos(selectedPackId, [
          {
            frameIndex: segment.frameIndex,
            description: segment.description,
            duration: segment.duration,
            repeat: count,
          },
        ]);

        const group = result.taskGroups.find(g => g.frameIndex === segment.frameIndex);
        if (group && group.taskIds.length > 0) {
          // Assign task IDs to candidates (still queued until first poll).
          const updatedCandidates = candidates.map((c, i) => {
            if (i < group.taskIds.length) {
              return { ...c, arkTaskId: group.taskIds[i], progress: 0, status: 'queued' as const };
            }
            return { ...c, status: 'failed' as const, error: '未获取到任务ID' };
          });

          updateSegment(segmentId, {
            arkTaskId: group.taskIds[0],
            generationProgress: 0,
            videoCandidates: updatedCandidates,
          });

          // Start independent polling for each candidate
          updatedCandidates.forEach((c, i) => {
            if (c.arkTaskId) {
              setTimeout(() => {
                startCandidatePolling(segmentId, c.id, c.arkTaskId);
              }, i * 1000);
            }
          });
        } else {
          updateSegment(segmentId, {
            generationStatus: 'failed',
            generationProgress: 0,
            generationError: '未获取到任务ID',
            videoCandidates: undefined,
          });
        }
      } catch (error) {
        updateSegment(segmentId, {
          generationStatus: 'failed',
          generationProgress: 0,
          generationError:
            error instanceof Error
              ? error.message
              : '创建多视频任务失败',
          videoCandidates: undefined,
        });
      }
    },
    [selectedPackId, updateSegment, startCandidatePolling],
  );

  // ── Batch video generation ──

  const batchGenerateAllVideos = useCallback(async (repeat: number = 1) => {
    if (!selectedPackId) return;

    const idleSegments = segmentsRef.current.filter(
      (s) =>
        (s.generationStatus === 'idle' || s.generationStatus === 'failed') &&
        s.description.trim().length > 0,
    );

    if (idleSegments.length === 0) return;

    // Mark eligible segments as generating
    const idleSegmentIds = new Set(idleSegments.map((s) => s.id));

    if (repeat > 1) {
      // Multi-video batch: initialize candidates for each segment
      const updated = segmentsRef.current.map((seg) => {
        if (!idleSegmentIds.has(seg.id)) return seg;
        const candidates: StoryboardVideoCandidate[] = Array.from({ length: repeat }, (_, i) => ({
          id: `candidate-${seg.id}-${i}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          arkTaskId: '',
          status: 'generating' as const,
          progress: 0,
        }));
        return {
          ...seg,
          generationStatus: 'generating' as const,
          generationProgress: 5,
          generationError: undefined,
          generatedVideoUrl: undefined,
          generatedVideoThumbnailUrl: undefined,
          videoCandidates: candidates,
          selectedCandidateId: undefined,
        };
      });
      onUpdateSegments(updated);

      try {
        const batchPayload = idleSegments.map((seg) => ({
          frameIndex: seg.frameIndex,
          description: seg.description,
          duration: seg.duration,
          repeat,
        }));

        const result = await batchGenerateVideos(selectedPackId, batchPayload);

        // Get the updated segments with candidates
        const currentSegs = segmentsRef.current;

        idleSegments.forEach((seg, segIdx) => {
          const group = result.taskGroups.find(g => g.frameIndex === seg.frameIndex);
          const currentSeg = currentSegs.find(s => s.id === seg.id);
          if (!group || !group.taskIds.length || !currentSeg?.videoCandidates) {
            updateSegment(seg.id, {
              generationStatus: 'failed',
              generationProgress: 0,
              generationError: '批量生成未返回任务ID',
              videoCandidates: undefined,
            });
            return;
          }

          const updatedCandidates = currentSeg.videoCandidates.map((c, i) => {
            if (i < group.taskIds.length) {
              return { ...c, arkTaskId: group.taskIds[i], progress: 10 };
            }
            return { ...c, status: 'failed' as const, error: '未获取到任务ID' };
          });

          updateSegment(seg.id, {
            arkTaskId: group.taskIds[0],
            generationProgress: 10,
            videoCandidates: updatedCandidates,
          });

          // Start polling for each candidate, staggered
          updatedCandidates.forEach((c, i) => {
            if (c.arkTaskId) {
              setTimeout(() => {
                startCandidatePolling(seg.id, c.id, c.arkTaskId);
              }, (segIdx * repeat + i) * 1000);
            }
          });
        });
      } catch (error) {
        idleSegments.forEach((seg) => {
          updateSegment(seg.id, {
            generationStatus: 'failed',
            generationProgress: 0,
            generationError:
              error instanceof Error
                ? error.message
                : '批量生成请求失败',
            videoCandidates: undefined,
          });
        });
      }
    } else {
      // Single video batch (original behavior)
      const updated = segmentsRef.current.map((seg) => {
        if (idleSegmentIds.has(seg.id)) {
          return {
            ...seg,
            generationStatus: 'generating' as const,
            generationProgress: 5,
            generationError: undefined,
            generatedVideoUrl: undefined,
            generatedVideoThumbnailUrl: undefined,
            videoCandidates: undefined,
            selectedCandidateId: undefined,
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

        // Update task IDs and start polling for each, staggered
        idleSegments.forEach((seg, i) => {
          const group = result.taskGroups.find(g => g.frameIndex === seg.frameIndex);
          if (group && group.taskIds.length > 0) {
            updateSegment(seg.id, {
              arkTaskId: group.taskIds[0],
              generationProgress: 10,
            });
            setTimeout(() => {
              startPolling(seg.id, group.taskIds[0]);
            }, i * 1000);
          } else {
            updateSegment(seg.id, {
              generationStatus: 'failed',
              generationProgress: 0,
              generationError: '批量生成未返回任务ID',
            });
          }
        });
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
    }
  }, [selectedPackId, onUpdateSegments, updateSegment, startPolling, startCandidatePolling]);

  // ── Cancel generation ──

  const cancelGeneration = useCallback(
    (segmentId: string) => {
      const segment = segmentsRef.current.find(s => s.id === segmentId);

      if (segment?.videoCandidates && segment.videoCandidates.length > 0) {
        // Multi-video: stop all candidate polling, preserve succeeded candidates
        for (const c of segment.videoCandidates) {
          stopPolling(c.id);
        }
        const updatedCandidates = segment.videoCandidates.map(c =>
          c.status === 'generating' ? { ...c, status: 'failed' as const, progress: 0, error: '已取消' } : c,
        );
        const anySucceeded = updatedCandidates.some(c => c.status === 'succeeded');
        const firstSucceeded = updatedCandidates.find(c => c.status === 'succeeded');

        updateSegment(segmentId, {
          videoCandidates: updatedCandidates,
          generationStatus: anySucceeded ? 'succeeded' : 'idle',
          generationProgress: anySucceeded ? 100 : 0,
          ...(anySucceeded && firstSucceeded && !segment.selectedCandidateId
            ? {
                selectedCandidateId: firstSucceeded.id,
                generatedVideoUrl: firstSucceeded.videoUrl,
                generatedVideoThumbnailUrl: firstSucceeded.thumbnailUrl,
              }
            : {}),
        });
      } else {
        // Single video: original behavior
        stopPolling(segmentId);
        updateSegment(segmentId, {
          generationStatus: 'idle',
          generationProgress: 0,
          arkTaskId: undefined,
        });
      }
    },
    [stopPolling, updateSegment],
  );

  // ── Select candidate ──

  const selectCandidate = useCallback(
    (segmentId: string, candidateId: string) => {
      const segment = segmentsRef.current.find(s => s.id === segmentId);
      if (!segment?.videoCandidates) return;

      const candidate = segment.videoCandidates.find(c => c.id === candidateId);
      if (!candidate || candidate.status !== 'succeeded' || !candidate.videoUrl) return;

      updateSegment(segmentId, {
        selectedCandidateId: candidateId,
        generatedVideoUrl: candidate.videoUrl,
        generatedVideoThumbnailUrl: candidate.thumbnailUrl,
      });
    },
    [updateSegment],
  );

  // ── Video composition ──

  const composeAllVideos = useCallback(async () => {
    if (!selectedPackId) return;

    // Check readiness: each segment must have at least one succeeded video
    const allReady = segmentsRef.current.every((s) => {
      if (s.videoCandidates && s.videoCandidates.length > 0) {
        return s.videoCandidates.some(c => c.status === 'succeeded' && c.videoUrl);
      }
      return s.generationStatus === 'succeeded' && s.generatedVideoUrl;
    });
    if (!allReady) return;

    setIsComposing(true);
    setCompositionError(null);

    try {
      // Collect video URLs in frame order, using selected candidate or first succeeded
      const sortedSegments = [...segmentsRef.current].sort(
        (a, b) => a.frameIndex - b.frameIndex,
      );
      const videoUrls = sortedSegments
        .map((s) => {
          if (s.videoCandidates && s.videoCandidates.length > 0) {
            // Use selected candidate, or first succeeded
            const selected = s.selectedCandidateId
              ? s.videoCandidates.find(c => c.id === s.selectedCandidateId)
              : null;
            if (selected?.videoUrl) return selected.videoUrl;
            const firstSucceeded = s.videoCandidates.find(c => c.status === 'succeeded' && c.videoUrl);
            return firstSucceeded?.videoUrl;
          }
          return s.generatedVideoUrl;
        })
        .filter((url): url is string => Boolean(url));

      const result = await composeVideo(selectedPackId, videoUrls);

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
      if (segment.generationStatus === 'generating') {
        if (segment.videoCandidates && segment.videoCandidates.length > 0) {
          // Resume candidate polling
          for (const c of segment.videoCandidates) {
            if (c.status === 'generating' && c.arkTaskId && !pollTimers.current.has(c.id)) {
              startCandidatePolling(segment.id, c.id, c.arkTaskId);
            }
          }
        } else if (segment.arkTaskId && !pollTimers.current.has(segment.id)) {
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
    isLoadingPack,
    selectedPackId,

    isDescribing,
    generateAllDescriptions,
    regenerateDescription,

    generateVideo,
    generateMultipleVideos,
    batchGenerateAllVideos,
    cancelGeneration,
    selectCandidate,

    composeAllVideos,
    isComposing,
    compositionError,

    overallProgress,
    totalDuration,
  };
}
