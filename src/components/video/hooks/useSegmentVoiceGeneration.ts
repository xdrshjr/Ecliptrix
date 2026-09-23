'use client';

/**
 * useSegmentVoiceGeneration — per-segment TTS moved out of ScriptPanel
 * (spec R2 §3.4.3). Generating a voice-over only adds a CANDIDATE to the
 * library; it never changes the timeline (I-2). Applying it is a separate,
 * undoable segment command.
 *
 * Changes over the moved code:
 *  1. voice / speed come from the segment override, else the project default;
 *  2. the text hash is taken when the request is SENT, and a reply for a
 *     deleted segment is discarded (a changed text is kept as a stale candidate);
 *  3. `segment.duration` is still written as before (I-11: AI video
 *     generators read it);
 *  4. a failure is kept on the segment card with the reason;
 *  5. batch conversion counts real failures;
 *  6. progress is mirrored into editorFocusStore for the task centre.
 */

import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type {
  AudioSentenceSegment,
  MaterialItem,
  ScriptSegment,
  SentenceTimingInfo,
} from '@/types';
import {
  convertScriptSegmentToSentenceRequest,
  convertSentencesToSpeech,
  type SentenceBatchTTSResponse as SentenceTTSResponse,
  type SentenceTTSResult,
} from '@/lib/api/tts';
import localAudioManager from '@/lib/utils/localAudioManager';
import { useNotification } from '@/contexts/NotificationContext';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { segmentTextHash } from '../lib/aiMix/segmentTextHash';
import { sanitizeTaskError } from '../workbench/collectActiveTasks';
import type { VideoEditingLogger } from '../utils';

export type VoiceGenerationOutcome = 'ok' | 'failed' | 'skipped' | 'discarded';

export interface UseSegmentVoiceGenerationOptions {
  taskId?: string;
  segmentsRef: MutableRefObject<ScriptSegment[]>;
  defaultVoiceId: string;
  logger: VideoEditingLogger;
  onAddMaterial?(material: MaterialItem): void;
  onUpdateSegments?(segments: ScriptSegment[]): void;
  getSegmentNumber(segmentId: string): number;
  /** Sentence timings of a finished generation (ScriptPanel's local state). */
  onVoiceGenerated?(segmentId: string, results: SentenceTTSResult[]): void;
  /** Background work after a successful generation (AI video prompts). */
  onVoiceReady?(segmentId: string): void;
}

export interface SegmentVoiceGeneration {
  convert(segment: ScriptSegment): Promise<VoiceGenerationOutcome>;
  convertMany(segmentIds: readonly string[]): Promise<{ ok: number; failed: number }>;
  convertingIds: ReadonlySet<string>;
  progress: Readonly<Record<string, number>>;
  isBatchConverting: boolean;
}

const PROGRESS_STEP = 8;
const PROGRESS_CAP = 85;
const PROGRESS_TICK_MS = 300;
const PROGRESS_CLEAR_MS = 2000;
const BATCH_GAP_MS = 1000;

interface RequestSnapshot {
  segment: ScriptSegment;
  voiceId: string;
  speed: number;
  textHash: string;
}

function hasSpeakableText(segment: ScriptSegment): boolean {
  const hasNarration = !!segment.narrationText && segment.narrationText.trim().length > 0;
  const hasSentences = segment.sentences?.some((sentence) => sentence.text.trim()) ?? false;
  return hasNarration || hasSentences;
}

function buildSentenceSegments(
  response: SentenceTTSResponse,
  segment: ScriptSegment,
): AudioSentenceSegment {
  const sentences: SentenceTimingInfo[] = response.sentence_results
    .filter((result) => result.success && result.start_time !== undefined && result.end_time !== undefined)
    .map((result) => ({
      sentence_id: result.sentence_id,
      text: segment.sentences.find((sentence) => sentence.id === result.sentence_id)?.text || '',
      order: result.order,
      start_time: result.start_time!,
      end_time: result.end_time!,
      duration: result.duration || (result.end_time! - result.start_time!),
    }));
  return { sentences, total_duration: response.total_duration || 0, segment_id: segment.id };
}

async function downloadAudio(url: string, fileName: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch concatenated audio from storage: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  await localAudioManager.storeAudioFile(fileName, blob);
  return blob;
}

export function useSegmentVoiceGeneration(
  options: UseSegmentVoiceGenerationOptions,
): SegmentVoiceGeneration {
  const { t } = useLocale();
  const { showSuccess, showError, showWarning } = useNotification();
  const [convertingIds, setConvertingIds] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const convertingRef = useRef<Set<string>>(new Set());
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const setVoiceError = useEditorFocusStore((state) => state.setSegmentVoiceError);
  const setVoiceProgress = useEditorFocusStore((state) => state.setSegmentVoiceProgress);

  const updateProgress = useCallback((segmentId: string, value: number | null) => {
    setProgress((previous) => {
      const next = { ...previous };
      if (value === null) delete next[segmentId];
      else next[segmentId] = value;
      return next;
    });
    setVoiceProgress(segmentId, value);
  }, [setVoiceProgress]);

  const markConverting = useCallback((segmentId: string, on: boolean) => {
    if (on) convertingRef.current.add(segmentId);
    else convertingRef.current.delete(segmentId);
    setConvertingIds(new Set(convertingRef.current));
  }, []);

  const buildMaterial = useCallback((
    request: RequestSnapshot,
    response: SentenceTTSResponse,
    fileName: string,
    blobSize: number,
  ): MaterialItem => {
    const { segment } = request;
    const segmentNumber = optionsRef.current.getSegmentNumber(segment.id);
    const prefix = t.scriptPanel.segments.segmentPrefix.replace('{index}', String(segmentNumber));
    const textLength = segment.sentences.reduce((sum, sentence) => sum + sentence.text.length, 0);
    return {
      id: `audio_${segment.id}_${Date.now()}`,
      name: `${prefix} - ${segment.title}${t.scriptPanel.segments.speechSuffix}`,
      type: 'audio',
      format: 'mp3',
      size: response.concatenated_file_size || blobSize,
      duration: response.total_duration || Math.ceil(textLength * 0.15),
      // iter5: persist the server URL so reloads don't yield a dead blob:.
      url: response.concatenated_audio_url!,
      serverUrl: response.concatenated_audio_url!,
      createdAt: new Date(),
      description: t.scriptPanel.messages.speechConvertDescription
        .replace('{index}', String(segmentNumber))
        .replace('{title}', segment.title)
        .replace('{count}', String(response.successful_sentences)),
      sentenceSegments: buildSentenceSegments(response, segment),
      metadata: {
        voice_type: request.voiceId,
        voice_speed: request.speed,
        text_length: textLength,
        segment_id: segment.id,
        segment_number: segmentNumber,
        segment_assigned_at: Date.now(),
        // The text this request read aloud (RV2): a reply after an edit is stale.
        segment_text_hash: request.textHash,
        task_id: optionsRef.current.taskId,
        fileName,
        server_file_name: fileName,
        actual_duration: response.total_duration,
        duration_method: 'concatenated_sentences',
        originalUrl: response.concatenated_audio_url,
        sentence_count: response.total_sentences,
        successful_sentences: response.successful_sentences,
        failed_sentences: response.failed_sentences,
        processing_time: response.total_processing_time,
        sentence_timing: response.sentence_results,
      },
    };
  }, [t]);

  /** I-11: keep writing segment.duration exactly as before the move. */
  const writeSegmentDuration = useCallback((segmentId: string, duration: number | undefined) => {
    const { segmentsRef, onUpdateSegments, logger } = optionsRef.current;
    if (!duration || !onUpdateSegments) return;
    const updated = segmentsRef.current.map((segment) =>
      (segment.id === segmentId ? { ...segment, duration } : segment));
    segmentsRef.current = updated;
    onUpdateSegments(updated);
    logger.info('脚本段落时长更新完成', { segmentId, updatedDuration: duration });
  }, []);

  const handleReply = useCallback(async (
    request: RequestSnapshot,
    response: SentenceTTSResponse,
  ): Promise<VoiceGenerationOutcome> => {
    const { segment } = request;
    const { segmentsRef, onAddMaterial, logger } = optionsRef.current;
    if (!response.success || !response.concatenated_audio_url || !onAddMaterial) {
      throw new Error(response.message || t.scriptPanel.errors.speechConversionFailed);
    }
    const latest = segmentsRef.current.find((candidate) => candidate.id === segment.id);
    if (!latest) {
      logger.warn('段落已删除，丢弃配音结果', { segmentId: segment.id });
      showWarning(t.workbench.segmentCommands.voiceDiscardedDeleted);
      return 'discarded';
    }
    optionsRef.current.onVoiceGenerated?.(segment.id, response.sentence_results);
    const audioUrl = response.concatenated_audio_url;
    const cleanUrl = audioUrl.includes('/object/sign/') ? audioUrl : audioUrl.split('?')[0];
    const fileName = audioUrl.split('/').pop()?.split('?')[0] || `audio_${segment.id}_${Date.now()}.mp3`;
    let blob: Blob;
    try {
      blob = await downloadAudio(cleanUrl, fileName);
    } catch (downloadError) {
      const detail = downloadError instanceof Error ? downloadError.message : String(downloadError);
      logger.error('拼接音频下载或存储失败', { segmentId: segment.id, fileName, error: detail });
      throw new Error(`${t.scriptPanel.errors.audioDownloadFailed}: ${detail}`);
    }
    onAddMaterial(buildMaterial(request, response, fileName, blob.size));
    writeSegmentDuration(segment.id, response.total_duration);
    if (segmentTextHash(latest) !== request.textHash) {
      showWarning(t.workbench.segmentCommands.voiceResultStale);
    } else {
      showSuccess(t.scriptPanel.messages.speechConvertComplete
        .replace('{success}', String(response.successful_sentences))
        .replace('{total}', String(response.total_sentences))
        .replace('{duration}', response.total_duration?.toFixed(1) || '0'));
    }
    optionsRef.current.onVoiceReady?.(segment.id);
    return 'ok';
  }, [buildMaterial, showSuccess, showWarning, t, writeSegmentDuration]);

  const convert = useCallback(async (segment: ScriptSegment): Promise<VoiceGenerationOutcome> => {
    const { logger, defaultVoiceId, taskId } = optionsRef.current;
    if (convertingRef.current.has(segment.id)) {
      logger.warn('该片段正在转换中，忽略重复请求', { segmentId: segment.id });
      return 'skipped';
    }
    const request: RequestSnapshot = {
      segment,
      voiceId: segment.voiceId ?? defaultVoiceId,
      speed: segment.voiceSpeed ?? 1.0,
      textHash: segmentTextHash(segment),
    };
    markConverting(segment.id, true);
    setVoiceError(segment.id, null);
    updateProgress(segment.id, 0);
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + PROGRESS_STEP, PROGRESS_CAP);
      updateProgress(segment.id, current);
    }, PROGRESS_TICK_MS);
    try {
      if (!hasSpeakableText(segment)) throw new Error(t.scriptPanel.errors.segmentTextEmpty);
      logger.info('开始句子级语音转换', {
        segmentId: segment.id, voiceId: request.voiceId, speed: request.speed, taskId,
      });
      const response = await convertSentencesToSpeech(convertScriptSegmentToSentenceRequest(
        segment, request.voiceId, request.speed, taskId, 3,
      ));
      clearInterval(timer);
      updateProgress(segment.id, 100);
      return await handleReply(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('句子级语音转换失败', { segmentId: segment.id, error: message, taskId });
      showError(t.scriptPanel.errors.speechConvertFailed.replace('{error}', message));
      setVoiceError(segment.id, sanitizeTaskError(message) ?? message);
      return 'failed';
    } finally {
      clearInterval(timer);
      markConverting(segment.id, false);
      setTimeout(() => updateProgress(segment.id, null), PROGRESS_CLEAR_MS);
    }
  }, [handleReply, markConverting, setVoiceError, showError, t, updateProgress]);

  const convertMany = useCallback(async (segmentIds: readonly string[]) => {
    const counts = { ok: 0, failed: 0 };
    if (isBatchConverting || segmentIds.length === 0) return counts;
    setIsBatchConverting(true);
    try {
      for (let index = 0; index < segmentIds.length; index += 1) {
        const segment = optionsRef.current.segmentsRef.current.find((s) => s.id === segmentIds[index]);
        if (!segment || convertingRef.current.has(segment.id)) continue;
        const outcome = await convert(segment);
        if (outcome === 'ok') counts.ok += 1;
        else if (outcome === 'failed') counts.failed += 1;
        if (index < segmentIds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, BATCH_GAP_MS));
        }
      }
    } finally {
      setIsBatchConverting(false);
    }
    return counts;
  }, [convert, isBatchConverting]);

  return { convert, convertMany, convertingIds, progress, isBatchConverting };
}
