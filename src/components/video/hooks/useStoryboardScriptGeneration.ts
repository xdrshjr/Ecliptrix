'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryboardScriptSegment, StoryboardPack, StoryboardVideoCandidate, MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { reportCredentialMissing } from '@/lib/credentialMissing';
import { ApiError } from '@/lib/api/http-client';
import { listPacks, getPack, describeFrames, batchGenerateVideos, composeVideo } from '@/lib/api/storyboard';
import { arkVideoMaterialId, arkVideoPollDelay, getArkVideoStatus, isArkVideoReady } from '@/lib/api/arkVideo';

const POLL_INTERVAL = 5000;
const WAIT_LIMIT = 10 * 60 * 1000;
const pendingStatus = (status: string) => status === 'queued' || status === 'generating';
interface Scope { projectKey?: string }
interface Submission { scope: Scope; controller: AbortController }
interface PollRequest extends Submission {
  segmentId: string;
  candidateId?: string;
  taskId: string;
  timer?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
}

export interface UseStoryboardScriptGenerationProps {
  segments: StoryboardScriptSegment[];
  onUpdateSegments: (segments: StoryboardScriptSegment[]) => void;
  onAddMaterial?: (material: MaterialItem) => void;
  taskId?: string;
  projectId?: string;
}
export interface UseStoryboardScriptGenerationReturn {
  availablePacks: StoryboardPack[];
  loadPack: (packId: string) => Promise<void>;
  refreshPacks: () => Promise<void>;
  isLoadingPacks: boolean;
  isLoadingPack: boolean;
  selectedPackId: string | null;
  isDescribing: boolean;
  generateAllDescriptions: () => Promise<void>;
  regenerateDescription: (segmentId: string) => Promise<void>;
  generateVideo: (segmentId: string) => void;
  generateMultipleVideos: (segmentId: string, count: number) => void;
  batchGenerateAllVideos: (repeat?: number) => void;
  cancelGeneration: (segmentId: string) => void;
  selectCandidate: (segmentId: string, candidateId: string) => void;
  composeAllVideos: () => Promise<void>;
  isComposing: boolean;
  compositionError: string | null;
  overallProgress: { completed: number; total: number };
  totalDuration: number;
}

function selectedFields(candidate: StoryboardVideoCandidate): Partial<StoryboardScriptSegment> {
  return { selectedCandidateId: candidate.id, generatedVideoUrl: candidate.videoUrl,
    generatedVideoThumbnailUrl: candidate.thumbnailUrl, generatedVideoDuration: candidate.duration,
    generatedVideoWidth: candidate.width, generatedVideoHeight: candidate.height, generatedVideoModel: candidate.model };
}

export function useStoryboardScriptGeneration({ segments, onUpdateSegments, onAddMaterial, taskId, projectId }: UseStoryboardScriptGenerationProps): UseStoryboardScriptGenerationReturn {
  const copy = useLocale().t.integrations.videoGeneration;
  const projectKey = projectId ?? taskId;
  const scope = useMemo<Scope>(() => ({ projectKey }), [projectKey]);
  const [availablePacks, setAvailablePacks] = useState<StoryboardPack[]>([]);
  const [isLoadingPacks, setIsLoadingPacks] = useState(false);
  const [isLoadingPack, setIsLoadingPack] = useState(false);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(segments[0]?.packId ?? null);
  const [isDescribing, setIsDescribing] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [compositionError, setCompositionError] = useState<string | null>(null);
  const requests = useRef(new Map<string, PollRequest>());
  const submissions = useRef(new Map<string, Submission>());
  const sequence = useRef(0);
  const mounted = useRef(true);
  const current = useRef({ segments, onUpdateSegments, onAddMaterial, scope, selectedPackId, copy });
  current.current = { segments, onUpdateSegments, onAddMaterial, scope, selectedPackId, copy };

  const replaceSegments = useCallback((next: StoryboardScriptSegment[]) => {
    current.current.segments = next;
    current.current.onUpdateSegments(next);
  }, []);
  const update = useCallback((id: string, patch: Partial<StoryboardScriptSegment>) => {
    replaceSegments(current.current.segments.map(segment => segment.id === id ? { ...segment, ...patch } : segment));
  }, [replaceSegments]);
  const stop = useCallback((key: string) => {
    const request = requests.current.get(key);
    if (request?.timer) clearTimeout(request.timer);
    if (request?.deadline) clearTimeout(request.deadline);
    request?.controller.abort();
    requests.current.delete(key);
  }, []);
  const isCurrentScope = useCallback((captured: Scope) => mounted.current && current.current.scope === captured, []);
  const active = useCallback((key: string, request: PollRequest) => {
    if (!isCurrentScope(request.scope) || requests.current.get(key) !== request || request.controller.signal.aborted) return false;
    const segment = current.current.segments.find(item => item.id === request.segmentId);
    if (!segment) return false;
    const target = request.candidateId ? segment.videoCandidates?.find(item => item.id === request.candidateId) : undefined;
    return target ? pendingStatus(target.status) && target.arkTaskId === request.taskId
      : !request.candidateId && pendingStatus(segment.generationStatus) && segment.arkTaskId === request.taskId;
  }, [isCurrentScope]);
  const updateCandidate = useCallback((segmentId: string, candidateId: string, patch: Partial<StoryboardVideoCandidate>) => {
    const segment = current.current.segments.find(item => item.id === segmentId);
    if (!segment?.videoCandidates) return;
    const candidates = segment.videoCandidates.map(candidate => candidate.id === candidateId ? { ...candidate, ...patch } : candidate);
    const waiting = candidates.some(candidate => pendingStatus(candidate.status));
    const selected = candidates.find(candidate => candidate.id === segment.selectedCandidateId && candidate.status === 'succeeded')
      ?? candidates.find(candidate => candidate.status === 'succeeded');
    update(segmentId, { videoCandidates: candidates,
      generationStatus: waiting ? (candidates.every(candidate => candidate.status === 'queued') ? 'queued' : 'generating')
        : selected ? 'succeeded' : candidates.every(candidate => candidate.status === 'timeout') ? 'timeout' : 'failed',
      generationProgress: waiting ? Math.round(candidates.reduce((sum, candidate) => sum + candidate.progress, 0) / candidates.length) : selected ? 100 : 0,
      generationError: waiting || selected ? undefined : patch.error,
      ...(selected ? selectedFields(selected) : {}),
    });
  }, [update]);

  const startPolling = useCallback((segmentId: string, taskId: string, candidateId?: string) => {
    const key = candidateId ?? segmentId;
    if (requests.current.has(key)) return;
    const request: PollRequest = { scope: current.current.scope, controller: new AbortController(), segmentId, candidateId, taskId };
    requests.current.set(key, request);
    let failures = 0;
    const fail = (message: string, timeout = false) => {
      if (!active(key, request)) return;
      if (candidateId) updateCandidate(segmentId, candidateId, { status: timeout ? 'timeout' : 'failed', progress: 0, error: message, queuePosition: undefined });
      else update(segmentId, { generationStatus: timeout ? 'timeout' : 'failed', generationProgress: 0, generationError: message, queuePosition: undefined });
      stop(key);
    };
    const tick = async () => {
      if (!active(key, request)) {
        if (requests.current.get(key) === request) stop(key);
        return;
      }
      let delay = POLL_INTERVAL;
      try {
        const result = await getArkVideoStatus(taskId, { signal: request.controller.signal });
        if (!active(key, request)) return;
        failures = 0;
        if (isArkVideoReady(result)) {
          const materialId = arkVideoMaterialId(result, taskId);
          const segment = current.current.segments.find(item => item.id === segmentId)!;
          if (candidateId) updateCandidate(segmentId, candidateId, { status: 'succeeded', progress: 100,
            videoUrl: result.video_url, thumbnailUrl: result.thumbnail_url, duration: result.duration,
            width: result.width, height: result.height, model: result.model, error: undefined, queuePosition: undefined });
          else update(segmentId, { generationStatus: 'succeeded', generationProgress: 100,
            generatedVideoUrl: result.video_url, generatedVideoThumbnailUrl: result.thumbnail_url,
            generatedVideoDuration: result.duration, generatedVideoWidth: result.width, generatedVideoHeight: result.height,
            generatedVideoModel: result.model, generationError: undefined, queuePosition: undefined });
          stop(key);
          current.current.onAddMaterial?.({ id: materialId, name: `分镜 ${segment.frameIndex + 1}`,
            type: 'video', format: 'mp4', size: 0, url: result.video_url!, serverUrl: result.video_url,
            cacheUrl: result.video_url, thumbnailUrl: result.thumbnail_url, duration: result.duration,
            width: result.width, height: result.height, createdAt: new Date(),
            metadata: { source: 'storyboard-script', model: result.model, arkTaskId: result.ark_task_id, frameIndex: segment.frameIndex } });
          return;
        }
        if (result.status === 'timeout') return fail(current.current.copy.waitTimeout, true);
        if (result.status === 'failed') return fail(result.error || result.error_code || current.current.copy.unsupported);
        const status = result.status === 'queued' ? 'queued' : 'generating';
        const progress = status === 'queued' ? 0 : result.phase === 'downloading' || result.phase === 'validating' ? 95 : 30;
        if (candidateId) updateCandidate(segmentId, candidateId, { status, progress, queuePosition: result.position_in_queue });
        else update(segmentId, { generationStatus: status, generationProgress: progress, queuePosition: result.position_in_queue });
      } catch (error) {
        if (!active(key, request)) return;
        const retry = arkVideoPollDelay(error, ++failures);
        if (retry === null) return fail(error instanceof ApiError ? error.message : current.current.copy.loadFailed);
        delay = retry;
      }
      if (active(key, request)) request.timer = setTimeout(tick, delay);
    };
    const timeoutSeconds = current.current.segments.find(item => item.id === segmentId)?.generationTimeoutSeconds;
    const waitLimit = timeoutSeconds && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds * 1000 : WAIT_LIMIT;
    request.deadline = setTimeout(() => fail(current.current.copy.waitTimeout, true), waitLimit);
    request.timer = setTimeout(tick, POLL_INTERVAL);
  }, [active, stop, update, updateCandidate]);

  const submit = useCallback(async (ids: string[], count: number) => {
    const packId = current.current.selectedPackId;
    if (!packId || !Number.isInteger(count) || count < 1) return;
    const eligible = current.current.segments.filter(segment => ids.includes(segment.id) && segment.description.trim()
      && !pendingStatus(segment.generationStatus) && !submissions.current.has(segment.id));
    if (!eligible.length) return;
    const submission: Submission = { scope: current.current.scope, controller: new AbortController() };
    const live = (id: string) => isCurrentScope(submission.scope) && submissions.current.get(id) === submission
      && !submission.controller.signal.aborted && current.current.segments.some(segment => segment.id === id && pendingStatus(segment.generationStatus));
    for (const segment of eligible) {
      submissions.current.set(segment.id, submission);
      update(segment.id, { generationStatus: 'queued', generationProgress: 0, generationError: undefined,
        arkTaskId: undefined, generatedVideoUrl: undefined, generatedVideoThumbnailUrl: undefined,
        generatedVideoDuration: undefined, generatedVideoWidth: undefined, generatedVideoHeight: undefined, generatedVideoModel: undefined,
        selectedCandidateId: undefined, queuePosition: undefined,
        videoCandidates: count > 1 ? Array.from({ length: count }, () => ({ id: `candidate-${segment.id}-${++sequence.current}`,
          arkTaskId: '', status: 'queued', progress: 0 })) : undefined });
    }
    try {
      const result = await batchGenerateVideos(packId, eligible.map(segment => ({ frameIndex: segment.frameIndex,
        description: segment.description, duration: segment.duration, repeat: count })), { signal: submission.controller.signal });
      for (const segment of eligible) {
        if (!live(segment.id)) continue;
        const taskIds = result.taskGroups.find(group => group.frameIndex === segment.frameIndex)?.taskIds ?? [];
        update(segment.id, { generationTimeoutSeconds: result.timeoutSeconds });
        if (!taskIds.length) {
          update(segment.id, { generationStatus: 'failed', generationError: current.current.copy.submissionUnknown, videoCandidates: undefined });
        } else if (count > 1) {
          const candidates = current.current.segments.find(item => item.id === segment.id)!.videoCandidates!.map((candidate, index) =>
            taskIds[index] ? { ...candidate, arkTaskId: taskIds[index] }
              : { ...candidate, status: 'failed' as const, error: current.current.copy.submissionUnknown });
          update(segment.id, { arkTaskId: taskIds[0], videoCandidates: candidates });
          for (const candidate of candidates) if (candidate.arkTaskId) startPolling(segment.id, candidate.arkTaskId, candidate.id);
        } else {
          update(segment.id, { arkTaskId: taskIds[0] });
          startPolling(segment.id, taskIds[0]);
        }
        submissions.current.delete(segment.id);
      }
    } catch (error) {
      if (isCurrentScope(submission.scope)) reportCredentialMissing(error);
      for (const segment of eligible) {
        if (!live(segment.id)) continue;
        update(segment.id, { generationStatus: 'failed', generationProgress: 0, videoCandidates: undefined,
          generationError: error instanceof ApiError && error.code === 'video_configuration_changed' ? current.current.copy.configurationChanged
            : error instanceof ApiError && error.code === 'generation_submission_unknown'
            ? current.current.copy.submissionUnknown : error instanceof Error ? error.message : current.current.copy.submissionUnknown });
        submissions.current.delete(segment.id);
      }
    }
  }, [isCurrentScope, startPolling, update]);
  const generateVideo = useCallback((id: string) => submit([id], 1), [submit]);
  const generateMultipleVideos = useCallback((id: string, count: number) => submit([id], count), [submit]);
  const batchGenerateAllVideos = useCallback((count = 1) => submit(current.current.segments.filter(segment =>
    ['idle', 'failed', 'timeout'].includes(segment.generationStatus)).map(segment => segment.id), count), [submit]);
  const cancelGeneration = useCallback((id: string) => {
    for (const [key, request] of Array.from(requests.current.entries())) if (request.segmentId === id) stop(key);
    const submission = submissions.current.get(id);
    submissions.current.delete(id);
    if (submission && !Array.from(submissions.current.values()).includes(submission)) submission.controller.abort();
    const segment = current.current.segments.find(item => item.id === id);
    const candidates = segment?.videoCandidates?.map(candidate => pendingStatus(candidate.status)
      ? { ...candidate, status: 'failed' as const, progress: 0, error: current.current.copy.waitTimeout } : candidate);
    const selected = candidates?.find(candidate => candidate.id === segment?.selectedCandidateId && candidate.status === 'succeeded')
      ?? candidates?.find(candidate => candidate.status === 'succeeded');
    update(id, { generationStatus: selected ? 'succeeded' : 'idle', generationProgress: selected ? 100 : 0,
      generationError: selected ? undefined : current.current.copy.waitTimeout, arkTaskId: undefined,
      queuePosition: undefined, videoCandidates: candidates, ...(selected ? selectedFields(selected) : {}) });
  }, [stop, update]);
  const selectCandidate = useCallback((id: string, candidateId: string) => {
    const candidate = current.current.segments.find(segment => segment.id === id)?.videoCandidates?.find(item => item.id === candidateId);
    if (candidate?.status === 'succeeded' && candidate.videoUrl) update(id, selectedFields(candidate));
  }, [update]);

  const refreshPacks = useCallback(async () => {
    if (!projectId) { setAvailablePacks([]); return; }
    setIsLoadingPacks(true);
    try { const packs = await listPacks(projectId); if (isCurrentScope(scope)) setAvailablePacks(packs); }
    catch { if (isCurrentScope(scope)) setAvailablePacks([]); }
    finally { if (isCurrentScope(scope)) setIsLoadingPacks(false); }
  }, [isCurrentScope, projectId, scope]);
  const loadPack = useCallback(async (packId: string) => {
    if (!projectId) return;
    current.current.segments.forEach(segment => { if (pendingStatus(segment.generationStatus)) cancelGeneration(segment.id); });
    setSelectedPackId(packId); current.current.selectedPackId = packId;
    setCompositionError(null); setIsLoadingPack(true);
    try {
      const pack = await getPack(projectId, packId);
      if (!isCurrentScope(scope) || current.current.selectedPackId !== packId) return;
      const scripted = pack.frames.length > 0 && pack.frames.every(frame => frame.script?.trim());
      replaceSegments(pack.frames.map(frame => ({ id: `storyboard-seg-${packId}-${frame.index}-${++sequence.current}`, packId,
        frameIndex: frame.index, frameUrl: frame.url, frameThumbnailUrl: frame.url,
        description: scripted ? frame.script!.trim() : frame.description || '', duration: 5,
        generationStatus: 'idle', generationProgress: 0, boundFromPack: scripted })));
    } catch (error) { if (isCurrentScope(scope)) reportCredentialMissing(error); }
    finally { if (isCurrentScope(scope)) setIsLoadingPack(false); }
  }, [cancelGeneration, isCurrentScope, projectId, replaceSegments, scope]);
  const describe = useCallback(async (id?: string) => {
    const packId = current.current.selectedPackId;
    const segment = current.current.segments.find(item => item.id === id);
    if (!packId || (id && !segment)) return;
    const captured = current.current.scope;
    setIsDescribing(true);
    try {
      const descriptions = await describeFrames(packId, segment ? [segment.frameIndex] : undefined);
      if (!isCurrentScope(captured) || current.current.selectedPackId !== packId) return;
      replaceSegments(current.current.segments.map(item => {
        const description = descriptions.find(entry => entry.index === item.frameIndex);
        return description ? { ...item, description: description.description } : item;
      }));
    } catch (error) { if (isCurrentScope(captured)) reportCredentialMissing(error); }
    finally { if (isCurrentScope(captured)) setIsDescribing(false); }
  }, [isCurrentScope, replaceSegments]);
  const generateAllDescriptions = useCallback(() => describe(), [describe]);
  const regenerateDescription = useCallback((id: string) => describe(id), [describe]);
  const composeAllVideos = useCallback(async () => {
    const packId = current.current.selectedPackId;
    const sorted = [...current.current.segments].sort((a, b) => a.frameIndex - b.frameIndex);
    if (!packId || !sorted.length || sorted.some(segment => !segment.generatedVideoUrl || segment.generationStatus !== 'succeeded')) return;
    const captured = current.current.scope;
    setIsComposing(true); setCompositionError(null);
    try {
      const result = await composeVideo(packId, sorted.map(segment => segment.generatedVideoUrl!));
      if (!isCurrentScope(captured) || current.current.selectedPackId !== packId || !result.videoUrl) return;
      current.current.onAddMaterial?.({ id: `storyboard-composed-${packId}-${Date.now()}`, name: '分镜合成视频',
        type: 'video', format: 'mp4', size: 0, url: result.videoUrl, serverUrl: result.videoUrl, cacheUrl: result.videoUrl,
        duration: sorted.reduce((sum, segment) => sum + (segment.generatedVideoDuration ?? segment.duration), 0),
        createdAt: new Date(), metadata: { source: 'storyboard-compose' } });
    } catch (error) { if (isCurrentScope(captured)) setCompositionError(error instanceof Error ? error.message : current.current.copy.loadFailed); }
    finally { if (isCurrentScope(captured)) setIsComposing(false); }
  }, [isCurrentScope]);

  useEffect(() => {
    mounted.current = true;
    setSelectedPackId(current.current.segments[0]?.packId ?? null);
    setIsDescribing(false); setIsLoadingPack(false); setIsComposing(false);
    void refreshPacks();
    return () => {
      mounted.current = false;
      for (const [key, request] of Array.from(requests.current.entries())) if (request.scope === scope) stop(key);
      for (const [id, submission] of Array.from(submissions.current.entries())) if (submission.scope === scope) {
        submission.controller.abort(); submissions.current.delete(id);
      }
    };
  }, [refreshPacks, scope, stop]);
  useEffect(() => {
    if (!current.current.selectedPackId && segments[0]?.packId) {
      current.current.selectedPackId = segments[0].packId;
      setSelectedPackId(segments[0].packId);
    }
    for (const [key, request] of Array.from(requests.current.entries())) if (!active(key, request)) stop(key);
    for (const [id, submission] of Array.from(submissions.current.entries())) {
      if (current.current.segments.some(segment => segment.id === id && pendingStatus(segment.generationStatus))) continue;
      submissions.current.delete(id);
      if (!Array.from(submissions.current.values()).includes(submission)) submission.controller.abort();
    }
    for (const segment of segments) {
      if (submissions.current.has(segment.id)) continue;
      if (segment.videoCandidates?.length) {
        for (const candidate of segment.videoCandidates) {
          if (!pendingStatus(candidate.status) || requests.current.has(candidate.id)) continue;
          if (candidate.arkTaskId) startPolling(segment.id, candidate.arkTaskId, candidate.id);
          else updateCandidate(segment.id, candidate.id, { status: 'failed', progress: 0,
            queuePosition: undefined, error: current.current.copy.submissionUnknown });
        }
      } else if (pendingStatus(segment.generationStatus) && !requests.current.has(segment.id)) {
        if (segment.arkTaskId) startPolling(segment.id, segment.arkTaskId);
        else update(segment.id, { generationStatus: 'failed', generationProgress: 0,
          queuePosition: undefined, generationError: current.current.copy.submissionUnknown });
      }
    }
  }, [segments, scope, active, startPolling, stop, update, updateCandidate]);

  return { availablePacks, loadPack, refreshPacks, isLoadingPacks, isLoadingPack, selectedPackId,
    isDescribing, generateAllDescriptions, regenerateDescription, generateVideo, generateMultipleVideos,
    batchGenerateAllVideos, cancelGeneration, selectCandidate, composeAllVideos, isComposing, compositionError,
    overallProgress: { completed: segments.filter(segment => segment.generationStatus === 'succeeded').length, total: segments.length },
    totalDuration: segments.reduce((sum, segment) => sum + (segment.generatedVideoDuration ?? segment.duration), 0) };
}
