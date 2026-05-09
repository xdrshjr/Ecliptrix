/**
 * Tests for VideoEditingLogger production gating (iter7 Bug #9).
 *
 * In production, info/debug/warn must be silent unless
 * NEXT_PUBLIC_VIDEO_EDIT_DEBUG is truthy. error stays unconditional.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoEditingLogger } from '../logger';

describe('VideoEditingLogger production gating', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    debugSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('warn() is silent in production when NEXT_PUBLIC_VIDEO_EDIT_DEBUG is unset', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VIDEO_EDIT_DEBUG', '');

    const logger = new VideoEditingLogger({ component: 'Test' });
    logger.warn('something', { key: 'value' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warn() runs when NEXT_PUBLIC_VIDEO_EDIT_DEBUG is truthy in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VIDEO_EDIT_DEBUG', '1');

    const logger = new VideoEditingLogger({ component: 'Test' });
    logger.warn('something', { key: 'value' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warn() runs in non-production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_VIDEO_EDIT_DEBUG', '');

    const logger = new VideoEditingLogger({ component: 'Test' });
    logger.warn('something', { key: 'value' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('error() is unconditional in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VIDEO_EDIT_DEBUG', '');

    const logger = new VideoEditingLogger({ component: 'Test' });
    logger.error('failure', new Error('bang'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
