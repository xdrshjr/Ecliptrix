/**
 * Regression guard for the desktop-only refactor (spec §5-P7).
 *
 * Two halves, and BOTH matter:
 *
 *  1. The auth surface stays gone. `http-client` must not re-export
 *     `MissingAuthError` / `SessionExpiredError` / `ForbiddenError`, and
 *     `RequestOptions` must not grow a `requireAuth` flag back (that one is
 *     enforced by `tsc`, since the option no longer exists). The desktop
 *     backend binds to 127.0.0.1 and has no user system, so re-introducing
 *     any of these means someone rebuilt a login for a machine with one user.
 *
 *  2. `RateLimitError` stays. It looks like part of the same family and it is
 *     not: `media_proxy_service` keeps its own per-IP download throttle, so a
 *     429 is still reachable. An earlier pass at this refactor deleted the 429
 *     branch along with the auth errors and turned every throttled download
 *     into an unclassified failure with no retry countdown. This half of the
 *     test exists to make that mistake loud.
 *
 * The symbol names below are quoted deliberately — a negative assertion has to
 * name what it forbids, so this file is the one place they may still appear.
 */

import { describe, it, expect } from 'vitest';

import * as httpClient from '../http-client';

const FORBIDDEN_EXPORTS = [
  'MissingAuthError',
  'SessionExpiredError',
  'ForbiddenError',
  'resetSessionExpiryFlag',
  '__resetSessionExpiryFlagForTests',
] as const;

describe('http-client: no auth surface', () => {
  it.each(FORBIDDEN_EXPORTS)('does not export %s', (name) => {
    expect(httpClient).not.toHaveProperty(name);
  });

  it('still exports RateLimitError with its 429 code', () => {
    expect(httpClient.RateLimitError).toBeTypeOf('function');
    expect(httpClient.RateLimitError.CODE).toBe('RATE_LIMITED');

    const err = new httpClient.RateLimitError(12, 'Too many requests');
    expect(err).toBeInstanceOf(httpClient.ApiError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(12);
  });

  it('still exports the error types the app actually handles', () => {
    expect(httpClient.ApiError).toBeTypeOf('function');
    expect(httpClient.TimeoutError).toBeTypeOf('function');
  });
});
