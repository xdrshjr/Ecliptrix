'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { reportCredentialMissing } from '@/lib/credentialMissing';
import { ApiError } from '@/lib/api/http-client';
import type { AIVideoScriptSegment, MaterialItem } from '@/types';
import {
  arkVideoMaterialId, arkVideoPollDelay, createArkVideoTask,
  getArkVideoStatus, getVideoModelConfiguration, isArkVideoReady,
  type ArkVideoGenerateParams,
} from '@/lib/api/arkVideo';
import { extractFrameFromEnd } from '../utils/extractVideoThumbnail';

const POLL_INTERVAL = 5000;
const WAIT_LIMIT = 10 * 60 * 1000;
interface VideoRequest {
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
  started: number;
  projectKey?: string;
}

export function useAIVideoScriptGeneration(
  segments: AIVideoScriptSegment[],
  onUpdateSegments: (segments: AIVideoScriptSegment[]) => void,
  onAddMaterial?: (material: MaterialItem) => void,
  projectKey?: string,
) {
  const { t } = useLocale();
  const copy = t.integrations.videoGeneration;
  const scriptCopy = t.scriptPanel.aiVideoScript;
  const requests = useRef(new Map<string, VideoRequest>());
  const current = useRef({ segments, onUpdateSegments, onAddMaterial, projectKey, copy, scriptCopy });
  current.current = { segments, onUpdateSegments, onAddMaterial, projectKey, copy, scriptCopy };

  const update = useCallback((id: string, patch: Partial<AIVideoScriptSegment>) => {
    const next = current.current.segments.map(segment => segment.id === id ? { ...segment, ...patch } : segment);
    current.current.segments = next;
    current.current.onUpdateSegments(next);
  }, []);

  const stop = useCallback((id: string) => {
    const request = requests.current.get(id);
    if (request?.timer) clearTimeout(request.timer);
    if (request?.deadline) clearTimeout(request.deadline);
    request?.controller.abort();
    requests.current.delete(id);
  }, []);

  const active = useCallback((id: string, request: VideoRequest, taskId?: string) => {
    const segment = current.current.segments.find(item => item.id === id);
    return requests.current.get(id) === request && !request.controller.signal.aborted
      && request.projectKey === current.current.projectKey && segment?.generationStatus === 'generating'
      && (!taskId || segment.arkTaskId === taskId);
  }, []);

  const poll = useCallback((id: string, taskId: string, request: VideoRequest) => {
    let failures = 0;
    const fail = (message: string) => {
      if (!active(id, request, taskId)) return;
      update(id, { generationStatus: 'failed', generationProgress: 0, generationError: message });
      stop(id);
    };
    const tick = async () => {
      if (!active(id, request, taskId)) {
        if (requests.current.get(id) === request) stop(id);
        return;
      }
      if (Date.now() - request.started >= WAIT_LIMIT) return fail(current.current.copy.waitTimeout);
      let delay = POLL_INTERVAL;
      try {
        const result = await getArkVideoStatus(taskId, { signal: request.controller.signal });
        if (!active(id, request, taskId)) return;
        failures = 0;
        if (isArkVideoReady(result)) {
          const materialId = arkVideoMaterialId(result, taskId);
          const segment = current.current.segments.find(item => item.id === id)!;
          update(id, {
            generationStatus: 'succeeded', generationProgress: 100,
            generatedVideoUrl: result.video_url, generatedVideoThumbnailUrl: result.thumbnail_url,
            generatedVideoDuration: result.duration, generatedVideoWidth: result.width,
            generatedVideoHeight: result.height, generationError: undefined,
          });
          stop(id);
          current.current.onAddMaterial?.({
            id: materialId, name: segment.title, type: 'video', format: 'mp4', size: 0,
            url: result.video_url!, serverUrl: result.video_url, cacheUrl: result.video_url,
            thumbnailUrl: result.thumbnail_url, duration: result.duration,
            width: result.width, height: result.height, createdAt: new Date(),
            metadata: { source: 'ai-video-script', model: result.model, arkTaskId: result.ark_task_id ?? taskId },
          });
          return;
        }
        if (result.status === 'timeout') return fail(current.current.copy.waitTimeout);
        if (result.status === 'failed') return fail(result.error || result.error_code || current.current.copy.unsupported);
        update(id, { generationProgress: result.phase === 'downloading' || result.phase === 'validating' ? 95 : 30 });
      } catch (error) {
        if (!active(id, request, taskId)) return;
        const retry = arkVideoPollDelay(error, ++failures);
        if (retry === null) return fail(error instanceof ApiError ? error.message : current.current.copy.loadFailed);
        delay = retry;
      }
      if (active(id, request, taskId)) request.timer = setTimeout(tick, delay);
    };
    request.deadline = setTimeout(() => fail(current.current.copy.waitTimeout), Math.max(0, WAIT_LIMIT - (Date.now() - request.started)));
    request.timer = setTimeout(tick, POLL_INTERVAL);
  }, [active, stop, update]);

  const generateVideo = useCallback(async (id: string) => {
    const index = current.current.segments.findIndex(segment => segment.id === id);
    const segment = current.current.segments[index];
    if (!segment?.scriptText.trim() || requests.current.has(id)) return;
    const request: VideoRequest = { controller: new AbortController(), started: Date.now(), projectKey: current.current.projectKey };
    requests.current.set(id, request);
    update(id, { generationStatus: 'generating', generationProgress: 3, arkTaskId: undefined,
      generationError: undefined, generatedVideoUrl: undefined, generatedVideoThumbnailUrl: undefined });
    let submitted = false;
    try {
      const configuration = await getVideoModelConfiguration(request.controller.signal);
      if (!active(id, request)) return;
      if (!configuration.configured) {
        const warning = configuration.configuration_warning;
        throw new ApiError(warning === 'integration_load_failed' ? 503 : warning === 'invalid_model_configuration' ? 422 : 409,
          warning === 'integration_load_failed' || warning === 'invalid_model_configuration' ? warning : 'credential_not_configured',
          warning ? current.current.copy.loadFailed : current.current.copy.notConfigured, { integration_id: 'ark_video' });
      }
      const params: ArkVideoGenerateParams = {
        prompt: segment.scriptText, duration: segment.duration ?? 5, camera_fixed: false, watermark: false,
        mode: segment.generationMode ?? 'description', resolution: '720p', aspect_ratio: '16:9',
        expected_config_revision: configuration.config_revision,
      };
      if (segment.autoTransition && index > 0) {
        const previous = current.current.segments[index - 1];
        if (previous?.generationStatus !== 'succeeded' || !previous.generatedVideoUrl) throw new Error(current.current.scriptCopy.previousVideoNotGenerated);
        const frame = await extractFrameFromEnd(previous.generatedVideoUrl, 3);
        if (!active(id, request)) return;
        if (!frame) throw new Error(current.current.copy.loadFailed);
        params.mode = 'keyframe';
        params.first_frame_url = frame;
      } else if (params.mode === 'keyframe') {
        if (!segment.firstFrameUrl) throw new Error(current.current.scriptCopy.firstFrameMissing);
        params.first_frame_url = segment.firstFrameUrl;
        params.last_frame_url = segment.lastFrameUrl;
      } else {
        params.image_urls = (params.mode === 'reference'
          ? [segment.referenceImageUrl, segment.referenceImage2Url]
          : [segment.characterImageUrl, segment.sceneImageUrl]).filter((url): url is string => !!url);
        if (params.mode === 'reference' && !params.image_urls.length) throw new Error(current.current.scriptCopy.referenceImageMissing);
      }
      if (!active(id, request)) return;
      const model = configuration.models.find(item => item.id === configuration.default_model);
      const images = params.image_urls ?? [];
      const hasImage = !!(images.length || params.first_frame_url || params.last_frame_url);
      if (!model || !model.modes.includes(params.mode!) || !model.resolutions.includes(params.resolution!)
        || !Number.isInteger(params.duration) || params.duration < model.duration_min || params.duration > model.duration_max
        || (hasImage && model.profile === 'text_only')
        || ((params.last_frame_url || (params.mode === 'description' && images.length > 1)) && !model.supports_last_frame)
        || (params.mode === 'reference' && images.length > model.max_reference_images)) {
        throw new ApiError(422, 'video_parameters_unsupported', current.current.copy.unsupported, { integration_id: 'ark_video' });
      }
      submitted = true;
      const result = await createArkVideoTask(params);
      if (!active(id, request)) return;
      update(id, { arkTaskId: result.ark_task_id, generationProgress: 10 });
      poll(id, result.ark_task_id, request);
    } catch (error) {
      if (!active(id, request)) return;
      const changed = error instanceof ApiError && error.code === 'video_configuration_changed';
      if (changed) {
        try { await getVideoModelConfiguration(request.controller.signal); } catch { /* 保留配置竞争提示，等待用户明确再生成。 */ }
        if (!active(id, request)) return;
      }
      reportCredentialMissing(error);
      update(id, { generationStatus: 'failed', generationProgress: 0,
        generationError: changed ? current.current.copy.configurationChanged
          : submitted && (!(error instanceof ApiError) || error.status === 0 || error.code === 'generation_submission_unknown')
          ? current.current.copy.submissionUnknown
          : error instanceof Error ? error.message : current.current.copy.loadFailed });
      stop(id);
    }
  }, [active, poll, stop, update]);

  const cancelGeneration = useCallback((id: string) => {
    stop(id);
    update(id, { generationStatus: 'idle', generationProgress: 0, arkTaskId: undefined,
      generationError: current.current.copy.waitTimeout });
  }, [stop, update]);

  useEffect(() => {
    for (const [id, request] of Array.from(requests.current.entries())) {
      if (!active(id, request)) stop(id);
    }
    for (const segment of segments) {
      if (segment.generationStatus !== 'generating' || requests.current.has(segment.id)) continue;
      if (!segment.arkTaskId) {
        // Tab 卸载后无法判断在途 POST 是否已受理；保留草稿，不能再次提交。
        update(segment.id, { generationStatus: 'failed', generationProgress: 0,
          generationError: current.current.copy.submissionUnknown });
        continue;
      }
      const request: VideoRequest = { controller: new AbortController(), started: Date.now(), projectKey };
      requests.current.set(segment.id, request);
      poll(segment.id, segment.arkTaskId, request);
    }
  }, [segments, projectKey, active, poll, stop, update]);

  useEffect(() => () => { Array.from(requests.current.keys()).forEach(stop); }, [projectKey, stop]);
  return { generateVideo, cancelGeneration };
}
