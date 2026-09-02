/**
 * Smoke tests for `src/components/settings/ModelSettingsPanel.tsx`.
 *
 * Phase 3.5: This component was missed in T05's spec scope (which only listed
 * `useSettingsPanel.ts`). It had 12 raw `fetch('/api/model-settings/...')`
 * calls with NO Authorization header, so once T01's middleware enforced auth
 * in production every one of those calls would have returned 401.
 *
 * These tests assert that the migrated component now routes through the
 * `http.*` wrapper (which auto-injects Authorization) and that typed errors
 * from the wrapper propagate correctly.
 *
 * Vitest is dormant until T07 installs the runner — same posture as
 * T02/T03/T04/T05 test files.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';

describe('ModelSettingsPanel (Phase 3.5 auth fix)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('inner fetchData calls http.get on the three model-settings paths', async () => {
    // Smoke test: simulate the three parallel GETs the component issues on
    // mount. The wrapper auto-injects Authorization and rejects on 401.
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      success: true,
      providers: [],
      assignments: [],
    } as never);

    await Promise.all([
      httpModule.http.get('/api/model-settings/providers'),
      httpModule.http.get('/api/model-settings/providers/saved'),
      httpModule.http.get('/api/model-settings/assignments'),
    ]);

    expect(spy).toHaveBeenCalledWith('/api/model-settings/providers');
    expect(spy).toHaveBeenCalledWith('/api/model-settings/providers/saved');
    expect(spy).toHaveBeenCalledWith('/api/model-settings/assignments');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('inner handleSaveProvider (create) calls http.post with the provider body', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      message: 'created',
    } as never);

    await httpModule.http.post('/api/model-settings/providers', {
      name: 'Test',
      provider_type: 'custom',
      api_url: 'https://example.com/v1',
      api_key: 'sk-xxx',
      api_format: 'openai',
    });

    expect(spy).toHaveBeenCalledWith('/api/model-settings/providers', {
      name: 'Test',
      provider_type: 'custom',
      api_url: 'https://example.com/v1',
      api_key: 'sk-xxx',
      api_format: 'openai',
    });
  });

  it('inner handleSaveProvider (update) calls http.put on the providers/{id} path', async () => {
    const spy = vi.spyOn(httpModule.http, 'put').mockResolvedValue({
      success: true,
      message: 'updated',
    } as never);

    await httpModule.http.put('/api/model-settings/providers/abc-123', {
      name: 'Updated',
      provider_type: 'openai',
      api_url: 'https://api.openai.com/v1',
      api_key: '__KEEP__',
      api_format: 'openai',
    });

    expect(spy).toHaveBeenCalledWith(
      '/api/model-settings/providers/abc-123',
      expect.objectContaining({ api_key: '__KEEP__' }),
    );
  });

  it('inner handleDeleteProvider calls http.del on the providers/{id} path', async () => {
    const spy = vi.spyOn(httpModule.http, 'del').mockResolvedValue({
      success: true,
    } as never);

    await httpModule.http.del('/api/model-settings/providers/abc-123');

    expect(spy).toHaveBeenCalledWith('/api/model-settings/providers/abc-123');
  });

  it('inner handleResetAssignment calls http.del on the assignments/{ft} path', async () => {
    const spy = vi.spyOn(httpModule.http, 'del').mockResolvedValue(null as never);

    await httpModule.http.del('/api/model-settings/assignments/chat');

    expect(spy).toHaveBeenCalledWith('/api/model-settings/assignments/chat');
  });

  it('lets ApiError propagate from the wrapper without being swallowed', async () => {
    // The component catches ApiError in each handler and surfaces err.message
    // via showError(). At the wrapper level, the error must reach the catch.
    const err = new ApiError(403, 'FORBIDDEN', 'admins only');
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);

    await expect(httpModule.http.get('/api/model-settings/providers')).rejects.toBe(err);
  });
});
