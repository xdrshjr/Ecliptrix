import { http } from '@/lib/api/http-client';
import { ScriptSegment } from '@/types';
import type { TtsErrorDetails } from '@/lib/ttsErrors';

/**
 * Text-to-Speech (TTS) API client
 */

export interface TTSRequest {
  text: string;
  voice_type: string;
  speed_ratio: number;
  segment_id?: string;
  task_id?: string;
}

export interface TTSResponse {
  success: boolean;
  message: string;
  data: {
    audio_url: string;
    duration: number;
    file_size: number;
    voice_type: string;
    text_length: number;
    request_id: string;
    file_name?: string;
    file_path?: string;
    speed_ratio?: number;
    segment_id?: string;
    task_id?: string;
    mock_mode?: boolean;
    duration_method?: string; // 时长获取方式：'ffmpeg' 或 'estimated'
    created_at?: string;
  };
}

export interface BatchTTSSegmentRequest {
  segment_id: string;
  text: string;
  title?: string;
}

export interface BatchTTSRequest {
  segments: BatchTTSSegmentRequest[];
  voice_type: string;
  speed_ratio: number;
  task_id?: string;
  concurrent_threads?: number;
}

export interface BatchTTSSegmentResult {
  segment_id: string;
  success: boolean;
  audio_url?: string;
  duration?: number;
  file_size?: number;
  error?: string;
  processing_time?: number;
}

export interface BatchTTSResponse {
  success: boolean;
  message: string;
  total_segments: number;
  successful_segments: number;
  failed_segments: number;
  total_processing_time: number;
  results: BatchTTSSegmentResult[];
}

export interface VoiceType {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
  category: string;
}

export interface VoiceTypesResponse {
  success: boolean;
  message: string;
  data: Record<string, VoiceType>;
}

export interface SentenceTTSRequest {
  sentence_id: string;
  text: string;
  order: number;
}

export interface SentenceBatchTTSRequest {
  segment_id: string;
  sentences: SentenceTTSRequest[];
  voice_type: string;
  speed_ratio: number;
  task_id?: string;
  concurrent_threads?: number;
}

export interface SentenceTTSResult {
  sentence_id: string;
  order: number;
  success: boolean;
  audio_url?: string;
  duration?: number;
  file_size?: number;
  start_time?: number;
  end_time?: number;
  error?: string;
  error_code?: string | null;
  error_details?: TtsErrorDetails | null;
  processing_time?: number;
}

export interface SentenceBatchTTSResponse {
  success: boolean;
  message: string;
  segment_id: string;
  total_sentences: number;
  successful_sentences: number;
  failed_sentences: number;
  total_processing_time: number;
  concatenated_audio_url?: string;
  total_duration?: number;
  concatenated_file_size?: number;
  sentence_results: SentenceTTSResult[];
}

/**
 * Convert text to speech.
 *
 * Long-running call (Volcano TTS can take 10-30s for long inputs); the
 * wrapper's per-request timeout is bumped to match.
 */
export async function convertTextToSpeech(request: TTSRequest): Promise<TTSResponse> {
  return http.post<TTSResponse>('/api/tts/convert', request, {
    timeoutMs: 120_000,
  });
}

/**
 * Convert multiple text segments to speech in batch.
 *
 * Batch TTS can take several minutes for long scripts; bump the timeout to
 * 5 minutes to match the previous behavior (the route uses Pattern C).
 */
export async function convertBatchTextToSpeech(request: BatchTTSRequest): Promise<BatchTTSResponse> {
  return http.post<BatchTTSResponse>('/api/tts/batch-convert', request, {
    timeoutMs: 300_000,
  });
}

/**
 * Convert sentences to speech with concatenation and timing information.
 */
export async function convertSentencesToSpeech(request: SentenceBatchTTSRequest): Promise<SentenceBatchTTSResponse> {
  return http.post<SentenceBatchTTSResponse>(
    '/api/tts/convert-sentences',
    request,
    { timeoutMs: 300_000 },
  );
}

/**
 * Convert script segments to batch TTS request format
 */
export function convertScriptSegmentsToBatchRequest(
  segments: ScriptSegment[],
  voiceType: string,
  speedRatio: number = 1.0,
  taskId?: string,
  concurrentThreads?: number
): BatchTTSRequest {
  const batchSegments: BatchTTSSegmentRequest[] = segments.map(segment => ({
    segment_id: segment.id,
    // 优先使用解说文案，降级使用视频脚本句子拼接
    text: segment.narrationText || segment.sentences.map(sentence => sentence.text).join(' '),
    title: segment.title
  }));

  return {
    segments: batchSegments,
    voice_type: voiceType,
    speed_ratio: speedRatio,
    task_id: taskId,
    concurrent_threads: concurrentThreads
  };
}

/**
 * Convert script segment to sentence-level TTS request format
 */
export function convertScriptSegmentToSentenceRequest(
  segment: ScriptSegment,
  voiceType: string,
  speedRatio: number = 1.0,
  taskId?: string,
  concurrentThreads?: number
): SentenceBatchTTSRequest {
  let sentences: SentenceTTSRequest[];

  if (segment.narrationText) {
    // 优先使用解说文案：拆句后作为TTS文本
    const narrationSentences = segment.narrationText
      .split(/(?<=[。！？.!?])\s*/)
      .filter(s => s.trim().length > 0);
    sentences = narrationSentences.map((text, index) => ({
      sentence_id: segment.sentences[index]?.id || `narration-s-${index}`,
      text: text.trim(),
      order: index
    }));
  } else {
    // 降级：使用视频脚本句子
    sentences = segment.sentences.map((sentence, index) => ({
      sentence_id: sentence.id,
      text: sentence.text,
      order: index
    }));
  }

  return {
    segment_id: segment.id,
    sentences: sentences,
    voice_type: voiceType,
    speed_ratio: speedRatio,
    task_id: taskId,
    concurrent_threads: concurrentThreads
  };
}

/**
 * Get available voice types.
 */
export async function getVoiceTypes(locale: string = 'zh-CN'): Promise<VoiceTypesResponse> {
  return http.get<VoiceTypesResponse>(`/api/tts/voice-types?locale=${locale}`);
}
