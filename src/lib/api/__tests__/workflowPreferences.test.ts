/**
 * Smoke tests for the new `src/lib/api/workflowPreferences.ts` client.
 *
 * Critical inheritance from T04: this client owns the
 * `userId → user_id` body key rename that previously lived in
 * `src/app/api/workflow-preferences/{save,load}/route.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import { save, load, type WorkflowPreferencesMap } from '../workflowPreferences';

const samplePrefs: WorkflowPreferencesMap = {
  'wf-1': {
    workflow_id: 'wf-1',
    workflow_name: 'Demo',
    is_expanded: true,
    tool_description: 'demo desc',
  },
};

describe('workflowPreferences API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('save (delegated rename from T04)', () => {
    it('renames userId → user_id in the request body', async () => {
      const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        message: 'ok',
        saved_count: 1,
      } as never);

      await save('user-1', samplePrefs);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe('/api/workflow-preferences/save');
      const body = spy.mock.calls[0][1] as Record<string, unknown>;
      // The load-bearing assertion: the camelCase userId is GONE.
      expect(body).not.toHaveProperty('userId');
      expect(body.user_id).toBe('user-1');
      expect(body.preferences).toEqual(samplePrefs);
    });

    it('lets ApiError propagate without wrapping', async () => {
      const err = new ApiError(500, 'INTERNAL', 'pref store down');
      vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);
      await expect(save('user-1', samplePrefs)).rejects.toBe(err);
    });
  });

  describe('load (delegated rename from T04)', () => {
    it('renames userId → user_id in the request body', async () => {
      const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        message: 'ok',
        preferences: samplePrefs,
      } as never);

      await load('user-1');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe('/api/workflow-preferences/load');
      const body = spy.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('userId');
      expect(body.user_id).toBe('user-1');
    });

    it('returns the raw preferences map for callers to convert', async () => {
      vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        preferences: samplePrefs,
      } as never);

      const result = await load('user-1');
      expect(result.success).toBe(true);
      expect(result.preferences['wf-1'].workflow_id).toBe('wf-1');
      expect(result.preferences['wf-1'].is_expanded).toBe(true);
    });
  });
});
