/**
 * Smoke tests for the new `src/lib/api/auth.ts` client.
 *
 * Critical inheritance from T04: this client owns the
 * `result.user → frontend User` reshape (camelCase normalization) that
 * previously lived in `src/app/api/auth/login/route.ts`. The first test in
 * this suite is the load-bearing assertion that proves the contract is
 * preserved.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as httpModule from '@/lib/api/http-client';
import { ApiError } from '@/lib/api/http-client';
import { login, register, validateSession, logout } from '../auth';

describe('auth API client', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('login (delegated reshape from T04)', () => {
    it('normalizes snake_case backend user fields to camelCase', async () => {
      vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        user: {
          id: 'u1',
          username: 'alice',
          email: 'a@b.c',
          full_name: 'Alice B',
          avatar_url: 'https://x.png',
          user_role: 'admin',
          is_admin: true,
          is_root: false,
        },
        session_token: 'sess-abc',
        message: 'welcome',
      } as never);

      const result = await login({ username: 'alice', password: 'pw' });

      expect(result.success).toBe(true);
      if (result.success) {
        // The reshape: snake_case → camelCase
        expect(result.user.id).toBe('u1');
        expect(result.user.username).toBe('alice');
        expect(result.user.fullName).toBe('Alice B');
        expect(result.user.avatarUrl).toBe('https://x.png');
        expect(result.user.userRole).toBe('admin');
        expect(result.user.isAdmin).toBe(true);
        expect(result.user.isRoot).toBe(false);
        expect(result.sessionToken).toBe('sess-abc');
      }
    });

    it('calls http.post with requireAuth:false (login is allowlisted)', async () => {
      const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        user: { id: 'u1', username: 'alice' },
        session_token: 'sess-abc',
      } as never);

      await login({ username: 'alice', password: 'pw' });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe('/api/auth/login');
      expect(spy.mock.calls[0][2]).toEqual({ requireAuth: false });
    });

    it('returns success:false envelope when backend says success:false', async () => {
      vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: false,
        error: 'Invalid credentials',
      } as never);

      const result = await login({ username: 'alice', password: 'wrong' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Invalid credentials');
      }
    });

    it('lets 5xx ApiError propagate without wrapping', async () => {
      const err = new ApiError(500, 'INTERNAL', 'auth down');
      vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);
      await expect(
        login({ username: 'alice', password: 'pw' }),
      ).rejects.toBe(err);
    });

    // Bug #1 (web-bug-report-20260509-iter2): 401 from the public login
    // endpoint must surface inline as `LoginFailure`, not throw — otherwise
    // wrong-credentials look like "session expired" to the user.
    it('converts 4xx ApiError into LoginFailure with backend message', async () => {
      const err = new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
      vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);

      const result = await login({ username: 'alice', password: 'wrong' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('用户名或密码错误');
      }
    });

    it('converts 422 validation error into LoginFailure', async () => {
      const err = new ApiError(422, 'VALIDATION_ERROR', 'Username is required');
      vi.spyOn(httpModule.http, 'post').mockRejectedValue(err);

      const result = await login({ username: '', password: 'x' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Username is required');
      }
    });
  });

  describe('register', () => {
    it('renames fullName → full_name and posts with requireAuth:false', async () => {
      const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        user: { id: 'u2', username: 'bob' },
      } as never);

      await register({
        username: 'bob',
        password: 'pw',
        email: 'b@b.c',
        fullName: 'Bob B',
      });

      expect(spy).toHaveBeenCalledWith(
        '/api/auth/register',
        expect.objectContaining({
          username: 'bob',
          password: 'pw',
          email: 'b@b.c',
          full_name: 'Bob B',
        }),
        { requireAuth: false },
      );
    });
  });

  describe('validateSession', () => {
    it('calls http.post on /api/auth/validate-session with requireAuth:false', async () => {
      const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
        valid: true,
      } as never);

      await validateSession({ user_id: 'u1', session_token: 'sess-abc' });

      expect(spy).toHaveBeenCalledWith(
        '/api/auth/validate-session',
        { user_id: 'u1', session_token: 'sess-abc' },
        { requireAuth: false },
      );
    });
  });

  describe('logout', () => {
    it('calls http.post on /api/auth/logout (requires auth)', async () => {
      const spy = vi.spyOn(httpModule.http, 'post').mockResolvedValue({
        success: true,
      } as never);

      await logout();

      // Note: no third argument means default requireAuth:true
      expect(spy).toHaveBeenCalledWith('/api/auth/logout', null);
    });
  });
});
