import { ScriptSegment } from '@/types';

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

/**
 * Convert text to speech
 */
export async function convertTextToSpeech(request: TTSRequest): Promise<TTSResponse> {
  try {
    console.log('[TTS API] 发送语音转换请求', {
      text_length: request.text.length,
      voice_type: request.voice_type,
      speed_ratio: request.speed_ratio,
      segment_id: request.segment_id,
      task_id: request.task_id
    });

    const response = await fetch('/api/tts/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: TTSResponse = await response.json();

    console.log('[TTS API] 语音转换响应', {
      success: result.success,
      audio_url: result.success ? result.data.audio_url : null,
      file_size: result.success ? result.data.file_size : null,
      message: result.message
    });

    return result;
  } catch (error) {
    console.error('[TTS API] 语音转换请求失败', {
      error: error instanceof Error ? error.message : String(error),
      request
    });
    throw error;
  }
}

/**
 * Convert multiple text segments to speech in batch
 */
export async function convertBatchTextToSpeech(request: BatchTTSRequest): Promise<BatchTTSResponse> {
  try {
    console.log('[Batch TTS API] 发送批量语音转换请求', {
      segments_count: request.segments.length,
      voice_type: request.voice_type,
      speed_ratio: request.speed_ratio,
      task_id: request.task_id,
      concurrent_threads: request.concurrent_threads,
      total_text_length: request.segments.reduce((sum, seg) => sum + seg.text.length, 0)
    });

    const response = await fetch('/api/tts/batch-convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: BatchTTSResponse = await response.json();

    console.log('[Batch TTS API] 批量语音转换响应', {
      success: result.success,
      total_segments: result.total_segments,
      successful_segments: result.successful_segments,
      failed_segments: result.failed_segments,
      total_processing_time: result.total_processing_time,
      message: result.message
    });

    return result;
  } catch (error) {
    console.error('[Batch TTS API] 批量语音转换请求失败', {
      error: error instanceof Error ? error.message : String(error),
      request: {
        segments_count: request.segments.length,
        voice_type: request.voice_type,
        task_id: request.task_id
      }
    });
    throw error;
  }
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
    text: segment.sentences.map(sentence => sentence.text).join(' '),
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
 * Get available voice types
 */
export async function getVoiceTypes(): Promise<VoiceTypesResponse> {
  try {
    console.log('[TTS API] 获取音色类型列表');

    const response = await fetch('/api/tts/voice-types', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: VoiceTypesResponse = await response.json();

    console.log('[TTS API] 音色类型列表响应', {
      success: result.success,
      voice_count: Object.keys(result.data).length,
      message: result.message
    });

    return result;
  } catch (error) {
    console.error('[TTS API] 获取音色类型列表失败', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Download audio file from server
 */
export async function downloadAudioFile(fileName: string): Promise<Blob> {
  try {
    console.log('[TTS API] 下载音频文件', { fileName });

    const response = await fetch(`/api/audio/generated/${fileName}`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const blob = await response.blob();

    console.log('[TTS API] 音频文件下载成功', {
      fileName,
      blobSize: blob.size,
      blobType: blob.type
    });

    return blob;
  } catch (error) {
    console.error('[TTS API] 音频文件下载失败', {
      fileName,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Check TTS service health
 */
export async function checkTTSHealth(): Promise<any> {
  try {
    console.log('[TTS API] 检查TTS服务健康状态');

    const response = await fetch('/api/tts/health', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();

    console.log('[TTS API] TTS健康检查响应', {
      status_code: response.status,
      service_status: result.status,
      config_valid: result.config_valid
    });

    return result;
  } catch (error) {
    console.error('[TTS API] TTS健康检查失败', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
} 