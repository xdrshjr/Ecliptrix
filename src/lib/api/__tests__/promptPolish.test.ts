import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError, TimeoutError } from '@/lib/api/http-client';
import { polishPrompt } from '../promptPolish';

describe('promptPolish API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('calls http.post on /api/prompt-polish with the params and 35s timeout', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      polishedPrompt: 'better prompt',
    } as never);

    const result = await polishPrompt({
      prompt: 'raw',
      targetType: 'normal',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/prompt-polish');
    expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 35_000 });
    expect(result.success).toBe(true);
    expect(result.polishedPrompt).toBe('better prompt');
  });

  it('maps TimeoutError to a Chinese-localized failure envelope (no string-matching)', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(new TimeoutError());
    const result = await polishPrompt({ prompt: 'raw', targetType: 'normal' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('请求超时，请重试');
  });

  it('maps ApiError to a structured failure envelope using typed error fields', async () => {
    vi.spyOn(httpModule.http, 'post').mockRejectedValue(
      new ApiError(500, 'INTERNAL', 'polish service down'),
    );
    const result = await polishPrompt({ prompt: 'raw', targetType: 'normal' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('polish service down');
  });
});
