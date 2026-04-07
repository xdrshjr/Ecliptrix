/**
 * Vitest unit tests for `src/lib/api/audioTranscription.ts`.
 *
 * Coverage: spec §7 cases C3, C4, C7 (Option A — exception propagation).
 *
 * Vitest is not yet installed (T07 owns runner setup); this file is valid
 * Vitest syntax that will run once the runner is wired up.
 *
 * The tests assert that:
 *   - `transcribeAudioFromPath` calls `http.upload('/api/audio/transcribe-local', fd)`
 *     with `file_path` appended to the FormData.
 *   - `transcribeAudioFromFile` calls `http.upload('/api/audio/transcribe', fd)`
 *     with the File appended under key `file`.
 *   - Default option values are applied (language=zh-CN, use_itn=true, etc.).
 *   - `ApiError` from the wrapper propagates to the caller (Option A).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/api/http-client', () => {
  return {
    http: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      del: vi.fn(),
      upload: vi.fn(),
    },
    ApiError: class ApiError extends Error {
      static readonly code = 'API_ERROR';
      readonly code: string;
      readonly status: number;
      readonly details?: Record<string, unknown>;
      constructor(
        status: number,
        code: string,
        message: string,
        details?: Record<string, unknown>,
      ) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
      }
    },
  };
});

import {
  transcribeAudioFromPath,
  transcribeAudioFromFile,
} from '../audioTranscription';
import { http, ApiError } from '@/lib/api/http-client';

function readForm(fd: FormData): Record<string, string | File> {
  const out: Record<string, string | File> = {};
  fd.forEach((value, key) => {
    out[key] = value as string | File;
  });
  return out;
}

const sampleSuccessResponse = {
  success: true,
  message: 'ok',
  job_id: 'job-123',
  subtitles: [
    { start_time: 0, end_time: 1000, text: '你好' },
    { start_time: 1000, end_time: 2000, text: '世界' },
  ],
  processing_time: 1.5,
  audio_duration: 2.0,
};

beforeEach(() => {
  (http.upload as unknown as Mock).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('audioTranscription.transcribeAudioFromPath', () => {
  // ---------------------------------------------------------------------------
  // C3 — calls http.upload('/api/audio/transcribe-local', fd) with file_path
  // ---------------------------------------------------------------------------
  it('C3: calls http.upload(/api/audio/transcribe-local, formData) with file_path', async () => {
    (http.upload as unknown as Mock).mockResolvedValueOnce(sampleSuccessResponse);

    const result = await transcribeAudioFromPath({
      file_path: '/tmp/audio.mp3',
      language: 'zh-CN',
      use_itn: true,
      use_punc: false,
      max_lines: 2,
      words_per_line: 15,
      generate_srt_file: true,
    });

    expect(http.upload).toHaveBeenCalledTimes(1);
    const call = (http.upload as unknown as Mock).mock.calls[0];
    expect(call[0]).toBe('/api/audio/transcribe-local');

    const fd = call[1] as FormData;
    expect(fd).toBeInstanceOf(FormData);

    const fields = readForm(fd);
    expect(fields.file_path).toBe('/tmp/audio.mp3');
    expect(fields.language).toBe('zh-CN');
    expect(fields.use_itn).toBe('true');
    expect(fields.use_punc).toBe('false');
    expect(fields.max_lines).toBe('2');
    expect(fields.words_per_line).toBe('15');
    expect(fields.generate_srt_file).toBe('true');

    expect(result.success).toBe(true);
    expect(result.subtitles).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // C3.b — defaults applied when options omitted
  // ---------------------------------------------------------------------------
  it('C3.b: applies default option values when caller omits them', async () => {
    (http.upload as unknown as Mock).mockResolvedValueOnce(sampleSuccessResponse);

    await transcribeAudioFromPath({ file_path: '/tmp/x.wav' });

    const fd = (http.upload as unknown as Mock).mock.calls[0][1] as FormData;
    const fields = readForm(fd);
    expect(fields.file_path).toBe('/tmp/x.wav');
    expect(fields.language).toBe('zh-CN');
    expect(fields.use_itn).toBe('true');
    expect(fields.use_punc).toBe('false');
    expect(fields.max_lines).toBe('2');
    expect(fields.words_per_line).toBe('15');
    expect(fields.generate_srt_file).toBe('true');
  });

  // ---------------------------------------------------------------------------
  // C7 — Option A: ApiError propagates to caller (no envelope wrapping)
  // ---------------------------------------------------------------------------
  it('C7: propagates ApiError from http-client (Option A — no envelope wrapping)', async () => {
    (http.upload as unknown as Mock).mockRejectedValueOnce(
      new ApiError(500, 'BACKEND_ERROR', 'transcription failed'),
    );

    await expect(
      transcribeAudioFromPath({ file_path: '/tmp/x.mp3' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('audioTranscription.transcribeAudioFromFile', () => {
  // ---------------------------------------------------------------------------
  // C4 — calls http.upload('/api/audio/transcribe', fd) with the File
  // ---------------------------------------------------------------------------
  it('C4: calls http.upload(/api/audio/transcribe, formData) with the File', async () => {
    (http.upload as unknown as Mock).mockResolvedValueOnce(sampleSuccessResponse);

    const file = new File(['fake-audio-bytes'], 'sample.mp3', {
      type: 'audio/mpeg',
    });

    const result = await transcribeAudioFromFile(file, {
      language: 'en-US',
      use_punc: true,
      max_lines: 3,
      words_per_line: 12,
      generate_srt_file: false,
    });

    expect(http.upload).toHaveBeenCalledTimes(1);
    const call = (http.upload as unknown as Mock).mock.calls[0];
    expect(call[0]).toBe('/api/audio/transcribe');

    const fd = call[1] as FormData;
    expect(fd).toBeInstanceOf(FormData);

    const fields = readForm(fd);
    expect(fields.file).toBeInstanceOf(File);
    expect((fields.file as File).name).toBe('sample.mp3');
    expect((fields.file as File).type).toBe('audio/mpeg');
    expect(fields.language).toBe('en-US');
    expect(fields.use_punc).toBe('true');
    expect(fields.max_lines).toBe('3');
    expect(fields.words_per_line).toBe('12');
    expect(fields.generate_srt_file).toBe('false');

    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // C4.b — defaults applied when options omitted entirely
  // ---------------------------------------------------------------------------
  it('C4.b: applies default option values when options object is omitted', async () => {
    (http.upload as unknown as Mock).mockResolvedValueOnce(sampleSuccessResponse);

    const file = new File(['x'], 'a.mp3', { type: 'audio/mpeg' });
    await transcribeAudioFromFile(file);

    const fd = (http.upload as unknown as Mock).mock.calls[0][1] as FormData;
    const fields = readForm(fd);
    expect(fields.language).toBe('zh-CN');
    expect(fields.use_itn).toBe('true');
    expect(fields.use_punc).toBe('false');
    expect(fields.max_lines).toBe('2');
    expect(fields.words_per_line).toBe('15');
    expect(fields.generate_srt_file).toBe('true');
  });

  // ---------------------------------------------------------------------------
  // C7 (file variant) — Option A: ApiError propagates
  // ---------------------------------------------------------------------------
  it('C7: propagates ApiError from http-client for the file-upload path (Option A)', async () => {
    (http.upload as unknown as Mock).mockRejectedValueOnce(
      new ApiError(413, 'PAYLOAD_TOO_LARGE', 'audio file exceeds 100MB'),
    );

    const file = new File(['x'], 'big.mp3', { type: 'audio/mpeg' });
    await expect(transcribeAudioFromFile(file)).rejects.toBeInstanceOf(ApiError);
  });
});
