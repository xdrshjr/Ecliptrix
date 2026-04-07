import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  convertTextToSpeech,
  convertBatchTextToSpeech,
  convertSentencesToSpeech,
  getVoiceTypes,
  type TTSRequest,
  type BatchTTSRequest,
} from '../tts';

describe('tts API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('convertTextToSpeech calls http.post on /api/tts/convert with the request and a 2 minute timeout', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      message: 'ok',
      data: { audio_url: 'https://x.mp3', duration: 5, file_size: 1024, voice_type: 'nova', text_length: 5, request_id: 'r1' },
    } as never);

    const req: TTSRequest = { text: 'hello', voice_type: 'nova', speed_ratio: 1 };
    await convertTextToSpeech(req);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/tts/convert');
    expect(spy.mock.calls[0][1]).toEqual(req);
    expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 120_000 });
  });

  it('convertBatchTextToSpeech uses /api/tts/batch-convert with a 5 minute timeout', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      message: 'ok',
      total_segments: 1,
      successful_segments: 1,
      failed_segments: 0,
      total_processing_time: 1,
      results: [],
    } as never);

    const req: BatchTTSRequest = {
      segments: [{ segment_id: 's1', text: 'hi' }],
      voice_type: 'nova',
      speed_ratio: 1,
    };
    await convertBatchTextToSpeech(req);

    expect(spy).toHaveBeenCalledWith('/api/tts/batch-convert', req, { timeoutMs: 300_000 });
  });

  it('convertSentencesToSpeech uses /api/tts/convert-sentences with a 5 minute timeout', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      message: 'ok',
      segment_id: 's1',
      total_sentences: 0,
      successful_sentences: 0,
      failed_sentences: 0,
      total_processing_time: 0,
      sentence_results: [],
    } as never);

    await convertSentencesToSpeech({
      segment_id: 's1',
      sentences: [{ sentence_id: 'x', text: 'y', order: 0 }],
      voice_type: 'nova',
      speed_ratio: 1,
    });

    expect(spy).toHaveBeenCalledWith(
      '/api/tts/convert-sentences',
      expect.any(Object),
      { timeoutMs: 300_000 },
    );
  });

  it('getVoiceTypes calls http.get with locale in the query string', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      message: 'ok',
      data: {},
    } as never);

    await getVoiceTypes('en-US');
    expect(spy).toHaveBeenCalledWith('/api/tts/voice-types?locale=en-US');
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(500, 'INTERNAL', 'tts down');
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);
    await expect(
      convertTextToSpeech({ text: 'hi', voice_type: 'nova', speed_ratio: 1 }),
    ).rejects.toBe(err);
  });
});
