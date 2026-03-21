/**
 * Audio Transcription API client
 * 音频转字幕API客户端
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export interface AudioTranscriptionRequest {
  file_path: string;
  language?: string;
  use_itn?: boolean;
  use_punc?: boolean;
  max_lines?: number;
  words_per_line?: number;
  generate_srt_file?: boolean;
}

export interface SubtitleItem {
  start_time: number; // 开始时间（毫秒）
  end_time: number;   // 结束时间（毫秒）
  text: string;       // 字幕文本
}

export interface AudioTranscriptionResponse {
  success: boolean;
  message: string;
  job_id: string;
  subtitles: SubtitleItem[];
  srt_content?: string;
  srt_file_path?: string;
  srt_file_url?: string;
  processing_time: number;
  audio_duration?: number;
}

export interface AudioTranscriptionErrorResponse {
  success: false;
  message: string;
  error: string;
  error_code: string;
  details?: Record<string, any>;
}

/**
 * Convert audio file to subtitles using local file path
 * 使用本地文件路径将音频转换为字幕
 */
export async function transcribeAudioFromPath(
  request: AudioTranscriptionRequest
): Promise<AudioTranscriptionResponse | AudioTranscriptionErrorResponse> {
  try {
    console.log('[Audio Transcription API] 发送音频转字幕请求', {
      file_path: request.file_path,
      language: request.language,
      use_itn: request.use_itn,
      use_punc: request.use_punc,
      max_lines: request.max_lines,
      words_per_line: request.words_per_line,
      generate_srt_file: request.generate_srt_file
    });

    // 准备表单数据
    const formData = new FormData();
    formData.append('file_path', request.file_path);
    formData.append('language', request.language || 'zh-CN');
    formData.append('use_itn', (request.use_itn ?? true).toString());
    formData.append('use_punc', (request.use_punc ?? false).toString());
    formData.append('max_lines', (request.max_lines ?? 2).toString());
    formData.append('words_per_line', (request.words_per_line ?? 15).toString());
    formData.append('generate_srt_file', (request.generate_srt_file ?? true).toString());

    const response = await fetch(`${API_BASE_URL}/api/audio/transcribe-local`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    console.log('[Audio Transcription API] 音频转字幕响应', {
      success: result.success,
      job_id: result.job_id,
      subtitle_count: result.subtitles?.length || 0,
      processing_time: result.processing_time,
      audio_duration: result.audio_duration
    });

    return result;
  } catch (error) {
    console.error('[Audio Transcription API] 音频转字幕请求失败', {
      error: error instanceof Error ? error.message : String(error),
      request
    });
    
    return {
      success: false,
      message: `音频转字幕失败: ${error instanceof Error ? error.message : String(error)}`,
      error: error instanceof Error ? error.message : String(error),
      error_code: 'NETWORK_ERROR'
    };
  }
}

/**
 * Convert audio file to subtitles by uploading file
 * 通过上传文件将音频转换为字幕
 */
export async function transcribeAudioFromFile(
  file: File,
  options: Omit<AudioTranscriptionRequest, 'file_path'> = {}
): Promise<AudioTranscriptionResponse | AudioTranscriptionErrorResponse> {
  try {
    console.log('[Audio Transcription API] 发送音频文件上传转字幕请求', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      language: options.language,
      use_itn: options.use_itn,
      use_punc: options.use_punc,
      max_lines: options.max_lines,
      words_per_line: options.words_per_line,
      generate_srt_file: options.generate_srt_file
    });

    // 准备表单数据
    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', options.language || 'zh-CN');
    formData.append('use_itn', (options.use_itn ?? true).toString());
    formData.append('use_punc', (options.use_punc ?? false).toString());
    formData.append('max_lines', (options.max_lines ?? 2).toString());
    formData.append('words_per_line', (options.words_per_line ?? 15).toString());
    formData.append('generate_srt_file', (options.generate_srt_file ?? true).toString());

    const response = await fetch(`${API_BASE_URL}/api/audio/transcribe`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    console.log('[Audio Transcription API] 音频文件转字幕响应', {
      success: result.success,
      job_id: result.job_id,
      subtitle_count: result.subtitles?.length || 0,
      processing_time: result.processing_time,
      audio_duration: result.audio_duration
    });

    return result;
  } catch (error) {
    console.error('[Audio Transcription API] 音频文件转字幕请求失败', {
      error: error instanceof Error ? error.message : String(error),
      fileName: file.name
    });
    
    return {
      success: false,
      message: `音频转字幕失败: ${error instanceof Error ? error.message : String(error)}`,
      error: error instanceof Error ? error.message : String(error),
      error_code: 'NETWORK_ERROR'
    };
  }
}

/**
 * Format subtitle time for display
 * 格式化字幕时间用于显示
 */
export function formatSubtitleTime(timeMs: number): string {
  const totalSeconds = Math.floor(timeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = timeMs % 1000;
  
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${Math.floor(milliseconds / 10).toString().padStart(2, '0')}`;
}