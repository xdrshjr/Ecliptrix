import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  getCategories,
  getCategorySettings,
  updateSetting,
  updateCategorySettings,
  resetCategory,
  resetAll,
  getAuditLog,
} from '../systemSettings';

describe('systemSettings API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('getCategories calls http.get on the categories endpoint', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      categories: [],
    } as never);

    await getCategories();
    expect(spy).toHaveBeenCalledWith('/api/system-settings/categories');
  });

  it('getCategorySettings calls http.get with the category in the path', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      category: 'tts',
      settings: [],
    } as never);

    await getCategorySettings('tts');
    expect(spy).toHaveBeenCalledWith('/api/system-settings/tts');
  });

  it('updateSetting calls http.put with category/key and a value envelope', async () => {
    const spy = vi.spyOn(httpModule.http, 'put').mockResolvedValue({
      success: true,
      message: 'ok',
    } as never);

    await updateSetting('tts', 'voice', 'nova');
    expect(spy).toHaveBeenCalledWith('/api/system-settings/tts/voice', { value: 'nova' });
  });

  it('updateCategorySettings calls http.put with a settings object', async () => {
    const spy = vi.spyOn(httpModule.http, 'put').mockResolvedValue({
      success: true,
      message: 'ok',
    } as never);

    const settings = { volume: 0.5, voice: 'nova' };
    await updateCategorySettings('tts', settings);
    expect(spy).toHaveBeenCalledWith('/api/system-settings/tts', { settings });
  });

  it('resetCategory uses http.post', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      message: 'ok',
    } as never);

    await resetCategory('tts');
    expect(spy).toHaveBeenCalledWith('/api/system-settings/tts/reset');
  });

  it('resetAll uses http.post on /reset-all', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      message: 'ok',
    } as never);

    await resetAll();
    expect(spy).toHaveBeenCalledWith('/api/system-settings/reset-all');
  });

  it('getAuditLog forwards filter params via query string', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      logs: [],
      total: 0,
    } as never);

    await getAuditLog({ category: 'tts', limit: 50, offset: 10 });
    const calledPath = spy.mock.calls[0][0] as string;
    expect(calledPath).toContain('/api/system-settings/audit-log?');
    expect(calledPath).toContain('category=tts');
    expect(calledPath).toContain('limit=50');
    expect(calledPath).toContain('offset=10');
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(403, 'FORBIDDEN', 'admins only');
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);
    await expect(getCategories()).rejects.toBe(err);
  });
});
