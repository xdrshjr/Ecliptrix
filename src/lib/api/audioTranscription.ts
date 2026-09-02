/**
 * Audio Transcription API client.
 * 音频转字幕 API 客户端
 *
 * Browser-only — uses the unified `http.upload` wrapper. The two functions
 * each route through a Next.js proxy (S06):
 *   - `transcribeAudioFromPath` → POST `/api/audio/transcribe-local`
 *   - `transcribeAudioFromFile` → POST `/api/audio/transcribe`
 *
 * `AudioTranscriptionErrorResponse` is not part of the return union: network
 * and backend failures propagate as `ApiError` from the HTTP wrapper, and the
 * single consumer `src/components/video/ScriptPanel.tsx` uses try/catch. The
 * legacy error type is still exported for back-compat with any imports that
 * have not yet migrated.
 */

import { http } from '@/lib/api/http-client';

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

/**
 * Legacy error envelope shape — kept exported for back-compat. The migrated
 * client functions no longer return this; backend/network errors propagate
 * as exceptions from the HTTP wrapper. Consumers should use try/catch.
 */
export interface AudioTranscriptionErrorResponse {
  success: false;
  message: string;
  error: string;
  error_code: string;
  details?: Record<string, any>;
}

function buildOptionsForm(
  options: Omit<AudioTranscriptionRequest, 'file_path'>,
): FormData {
  const formData = new FormData();
  formData.append('language', options.language || 'zh-CN');
  formData.append('use_itn', (options.use_itn ?? true).toString());
  formData.append('use_punc', (options.use_punc ?? false).toString());
  formData.append('max_lines', (options.max_lines ?? 2).toString());
  formData.append('words_per_line', (options.words_per_line ?? 15).toString());
  formData.append(
    'generate_srt_file',
    (options.generate_srt_file ?? true).toString(),
  );
  return formData;
}

/**
 * Convert audio to subtitles by referencing a server-side file path.
 * 使用本地文件路径将音频转换为字幕
 *
 * @throws `ApiError` / `TimeoutError` from the HTTP wrapper. Wrap the call in
 *         try/catch.
 */
export async function transcribeAudioFromPath(
  request: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResponse> {
  const formData = buildOptionsForm(request);
  formData.append('file_path', request.file_path);

  return http.upload<AudioTranscriptionResponse>(
    '/api/audio/transcribe-local',
    formData,
  );
}

/**
 * Convert audio to subtitles by uploading a File from the browser.
 * 通过上传文件将音频转换为字幕
 *
 * @throws `ApiError` / `TimeoutError` from the HTTP wrapper. Wrap the call in
 *         try/catch.
 */
export async function transcribeAudioFromFile(
  file: File,
  options: Omit<AudioTranscriptionRequest, 'file_path'> = {},
): Promise<AudioTranscriptionResponse> {
  const formData = buildOptionsForm(options);
  formData.append('file', file);

  return http.upload<AudioTranscriptionResponse>(
    '/api/audio/transcribe',
    formData,
  );
}

/**
 * Format subtitle time for display.
 * 格式化字幕时间用于显示
 */
export function formatSubtitleTime(timeMs: number): string {
  const totalSeconds = Math.floor(timeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = timeMs % 1000;

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${Math.floor(milliseconds / 10).toString().padStart(2, '0')}`;
}
