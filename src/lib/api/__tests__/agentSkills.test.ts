import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(),
}));

vi.mock('@/lib/api/http-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/http-client')>(
    '@/lib/api/http-client');
  return { ...actual, http };
});

import { ApiError } from '@/lib/api/http-client';
import {
  createSkill, deleteSkill, duplicateSkill, getSkill, invalidateSkillsCache,
  listSkills, setSkillEnabled, updateSkill, validateSkill,
} from '@/lib/api/agentSkills';

const SUMMARY = { id: 'quick-assemble', name: '速剪' };
const ok = <T,>(data: T) => ({ success: true, data });

beforeEach(() => {
  vi.useRealTimers();
  Object.values(http).forEach(mock => mock.mockReset());
  invalidateSkillsCache();
});

describe('agentSkills client', () => {
  it('caches the list for 30 seconds and refetches after invalidate', async () => {
    http.get.mockResolvedValue(ok({ skills: [SUMMARY] }));
    expect(await listSkills()).toEqual([SUMMARY]);
    await listSkills();
    expect(http.get).toHaveBeenCalledTimes(1);

    invalidateSkillsCache();
    await listSkills();
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('expires the cache after 30 seconds and honours force', async () => {
    vi.useFakeTimers();
    http.get.mockResolvedValue(ok({ skills: [] }));
    await listSkills();
    vi.advanceTimersByTime(29_000);
    await listSkills();
    expect(http.get).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await listSkills();
    expect(http.get).toHaveBeenCalledTimes(2);
    await listSkills({ force: true });
    expect(http.get).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    http.get.mockResolvedValue(ok({ skills: [SUMMARY] }));
    await Promise.all([listSkills(), listSkills(), listSkills()]);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed list request', async () => {
    http.get.mockRejectedValueOnce(new ApiError(502, 'storage_unavailable', 'x'));
    await expect(listSkills()).rejects.toBeInstanceOf(ApiError);
    http.get.mockResolvedValueOnce(ok({ skills: [SUMMARY] }));
    expect(await listSkills()).toEqual([SUMMARY]);
  });

  it('invalidates the list after every mutation', async () => {
    http.get.mockResolvedValue(ok({ skills: [] }));
    http.post.mockResolvedValue(ok({ id: 'my-skill', enabled: false }));
    http.put.mockResolvedValue(ok({ id: 'my-skill' }));
    http.del.mockResolvedValue(ok({ id: 'my-skill', deleted: true }));
    const mutations: Array<() => Promise<unknown>> = [
      () => createSkill('m'), () => updateSkill('my-skill', 'm'),
      () => deleteSkill('my-skill'), () => setSkillEnabled('my-skill', false),
      () => duplicateSkill('my-skill', 'copy-skill'),
    ];
    for (const mutate of mutations) {
      await listSkills();
      await listSkills();
      const before = http.get.mock.calls.length;
      await mutate();
      await listSkills();
      expect(http.get.mock.calls.length).toBe(before + 1);
    }
  });

  it('sends the documented paths and bodies', async () => {
    http.get.mockResolvedValue(ok({ id: 'my-skill' }));
    http.post.mockResolvedValue(ok({ id: 'my-skill', enabled: true }));
    await getSkill('my-skill');
    await setSkillEnabled('my-skill', true);
    await duplicateSkill('my-skill', 'copy-skill');
    expect(http.get).toHaveBeenCalledWith('/api/agent-skills/my-skill');
    expect(http.post).toHaveBeenCalledWith(
      '/api/agent-skills/my-skill/enabled', { enabled: true });
    expect(http.post).toHaveBeenCalledWith(
      '/api/agent-skills/my-skill/duplicate', { new_id: 'copy-skill' });
  });

  it('propagates server errors as ApiError with the backend code', async () => {
    http.put.mockRejectedValue(new ApiError(403, 'builtin_readonly', 'ro'));
    await expect(updateSkill('quick-assemble', 'm')).rejects.toMatchObject({
      code: 'builtin_readonly', status: 403,
    });
  });
});

describe('validateSkill', () => {
  it('returns the parsed preview as valid', async () => {
    http.post.mockResolvedValue(ok({ valid: true, id: 'my-skill', warnings: [] }));
    const result = await validateSkill('m');
    expect(result).toMatchObject({ valid: true, id: 'my-skill' });
    expect(http.post).toHaveBeenCalledWith(
      '/api/agent-skills/validate', { markdown: 'm' });
  });

  it('folds 422 and 413 into valid:false instead of throwing', async () => {
    http.post.mockRejectedValueOnce(new ApiError(422, 'invalid_skill', '保留字'));
    expect(await validateSkill('m')).toEqual({
      valid: false, error_code: 'invalid_skill', message: '保留字',
    });
    http.post.mockRejectedValueOnce(new ApiError(413, 'skill_too_large', '太大'));
    expect(await validateSkill('m')).toMatchObject({
      valid: false, error_code: 'skill_too_large',
    });
  });

  it('still throws for transport and guard failures', async () => {
    http.post.mockRejectedValueOnce(new ApiError(403, 'origin_forbidden', 'x'));
    await expect(validateSkill('m')).rejects.toMatchObject({ status: 403 });
    http.post.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'x'));
    await expect(validateSkill('m')).rejects.toBeInstanceOf(ApiError);
  });

  it('never touches the cached list', async () => {
    http.get.mockResolvedValue(ok({ skills: [] }));
    http.post.mockResolvedValue(ok({ valid: true }));
    await listSkills();
    await validateSkill('m');
    await listSkills();
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});
