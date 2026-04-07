import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import {
  getUserList,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser,
  getUserStats,
} from '../userManagement';

describe('userManagement API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('getUserList builds query string and calls http.get', async () => {
    const spy = vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      data: { users: [{ id: '1', username: 'a' }], total: 1, page: 1, page_size: 10, total_pages: 1 },
    } as never);

    await getUserList({ page: 1, pageSize: 10, role: 'admin', search: 'foo' });

    const calledPath = spy.mock.calls[0][0] as string;
    expect(calledPath).toMatch(/^\/api\/admin\/users\/list\?/);
    expect(calledPath).toContain('page=1');
    expect(calledPath).toContain('page_size=10');
    expect(calledPath).toContain('role=admin');
    expect(calledPath).toContain('search=foo');
  });

  it('createUser calls http.post with snake_case body', async () => {
    const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      user: { id: '1', username: 'a' },
    } as never);

    await createUser({
      username: 'a',
      password: 'pw',
      email: 'a@b.c',
      fullName: 'A B',
      userRole: 'regular',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/admin/users/create');
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body.full_name).toBe('A B');
    expect(body.user_role).toBe('regular');
    expect(body.is_admin).toBe(false);
  });

  it('updateUser calls http.put with the user-edit path', async () => {
    const spy = vi.spyOn(httpModule.http, 'put').mockResolvedValue({
      success: true,
    } as never);

    await updateUser('uid-1', { email: 'x@y.z', userRole: 'admin' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/admin/users/uid-1/edit');
    const body = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(body.email).toBe('x@y.z');
    expect(body.is_admin).toBe(true);
  });

  it('toggleUserStatus uses http.post and normalizes is_active', async () => {
    vi.spyOn(httpModule.http, 'post').mockResolvedValue({
      success: true,
      is_active: false,
    } as never);

    const result = await toggleUserStatus('uid-1');
    expect(result.isActive).toBe(false);
  });

  it('deleteUser uses http.del', async () => {
    const spy = vi.spyOn(httpModule.http, 'del').mockResolvedValue({
      success: true,
    } as never);

    await deleteUser('uid-1');
    expect(spy).toHaveBeenCalledWith('/api/admin/users/uid-1/delete');
  });

  it('getUserStats normalizes snake_case → camelCase', async () => {
    vi.spyOn(httpModule.http, 'get').mockResolvedValue({
      data: {
        total_users: 10,
        admin_count: 1,
        premium_count: 2,
        regular_count: 7,
        active_count: 9,
        disabled_count: 1,
        online_count: 3,
      },
    } as never);

    const stats = await getUserStats();
    expect(stats.totalUsers).toBe(10);
    expect(stats.adminCount).toBe(1);
    expect(stats.onlineCount).toBe(3);
  });

  it('lets ApiError propagate without wrapping', async () => {
    const err = new ApiError(403, 'FORBIDDEN', 'admins only');
    vi.spyOn(httpModule.http, 'get').mockRejectedValue(err);
    await expect(getUserList()).rejects.toBe(err);
  });
});
