import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import { getUserMaterials } from '../userMaterials';

describe('userMaterials API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('calls http.get with the user-materials path and forwards filter params', async () => {
    const fakeResp = {
      success: true,
      materials: [],
      total: 0,
      page: 1,
      page_size: 20,
      total_pages: 0,
    };
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue(fakeResp as never);

    await getUserMaterials('user-1', 2, 10, 'video');

    expect(spy).toHaveBeenCalledTimes(1);
    const calledPath = spy.mock.calls[0][0] as string;
    expect(calledPath).toContain('/api/storage/user-materials?');
    expect(calledPath).toContain('user_id=user-1');
    expect(calledPath).toContain('page=2');
    expect(calledPath).toContain('page_size=10');
    expect(calledPath).toContain('material_type=video');
  });

  it('maps any wrapper error to a structured failure envelope', async () => {
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(
      new ApiError(500, 'INTERNAL', 'storage broken'),
    );

    const result = await getUserMaterials('user-2');
    expect(result.success).toBe(false);
    expect(result.materials).toEqual([]);
    expect(result.message).toContain('storage broken');
  });
});
