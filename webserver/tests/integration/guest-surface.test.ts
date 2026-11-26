import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { resetAll } from '@/server/auth/rateLimit'
import {
  NOINDEX_PREFIXES,
  PUBLIC_API_PREFIXES,
  PUBLIC_PAGES,
  isPublicPath,
} from '@/server/auth/publicSurface'
import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'
import robots from '@/app/robots'

/**
 * The guest contract (spec §3.5, AC-25…AC-29).
 *
 * "A visitor may read the site but may not download the installer" used to be true
 * by accident: nothing named it, so the next route someone added could not tell
 * whether its absence from an implicit rule was deliberate. `publicSurface.ts` is
 * that name, and these cases pin it — including the two invariants that a later
 * refactor would break silently: the installer endpoint stays behind a session, and
 * the console stays out of search results in BOTH the header and `robots.txt`.
 */

let harness: TestHarness

beforeEach(async () => {
  harness = await createHarness()
  resetAll()
})

afterEach(() => {
  harness.teardown()
})

describe('the public path list', () => {
  it('names whole pages, never a prefix that could swallow a neighbour', () => {
    // A `startsWith('/admin')` rule one bug away from serving `/administrator`.
    for (const page of PUBLIC_PAGES) {
      expect(page.startsWith('/')).toBe(true)
      expect(page).not.toContain('*')
    }
    expect(isPublicPath('/download')).toBe(true)
    expect(isPublicPath('/downloads')).toBe(false)
    expect(isPublicPath('/legal/terms')).toBe(true)
  })

  it('keeps the installer bytes off the anonymous list', () => {
    // The one requirement that is a security statement, not a convenience.
    expect(isPublicPath('/api/v1/downloads/stable/win')).toBe(false)
    expect(PUBLIC_API_PREFIXES.some((prefix) => prefix.startsWith('/api/v1/downloads'))).toBe(false)
  })

  it('lets the sign-up and sign-in surfaces through', () => {
    expect(isPublicPath('/api/v1/auth/login')).toBe(true)
    expect(isPublicPath('/api/v1/auth/register')).toBe(true)
    expect(isPublicPath('/api/v1/auth/captcha')).toBe(true)
    expect(isPublicPath('/api/v1/meta')).toBe(true)
  })

  it('does not treat the console as public', () => {
    for (const path of ['/account', '/account/security', '/admin', '/admin/users']) {
      expect(isPublicPath(path), path).toBe(false)
    }
  })
})

describe('middleware', () => {
  function request(path: string): NextRequest {
    return new NextRequest(`http://127.0.0.1:8787${path}`)
  }

  it('marks account and console responses noindex (AC-29)', () => {
    for (const prefix of NOINDEX_PREFIXES) {
      // A cookie must be present, or the redirect path is taken instead — and the
      // redirect is where a guest is stopped, which is a different assertion.
      const req = request(prefix)
      req.cookies.set('ecs_session', 'placeholder')
      const response = middleware(req)
      expect(response.headers.get('x-robots-tag'), prefix).toContain('noindex')
    }
  })

  it('does not mark the landing page noindex', () => {
    const response = middleware(request('/'))
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  it('bounces a guest away from the console with a next hint (AC-28)', () => {
    const response = middleware(request('/admin/users?page=2'))
    expect([302, 307]).toContain(response.status)
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/login')
    expect(decodeURIComponent(location)).toContain('next=/admin/users')
  })

  it('leaves the public pages alone', () => {
    for (const page of ['/', '/download', '/login', '/register']) {
      const response = middleware(request(page))
      expect(response.headers.get('location'), page).toBeNull()
    }
  })
})

/** `disallow` as a flat list — the route may return one rule or an array. */
function disallowList(): string[] {
  const result = robots()
  const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules
  if (!rule) return []
  const disallow = rule.disallow
  if (Array.isArray(disallow)) return disallow.map(String)
  return disallow === undefined ? [] : [String(disallow)]
}

describe('robots.txt', () => {
  it('disallows the console, the account centre and the API (AC-29)', () => {
    const disallow = disallowList()
    for (const prefix of [...NOINDEX_PREFIXES, '/api/']) {
      expect(disallow, prefix).toContain(prefix)
    }
  })

  it('shares its list with the header instead of keeping a second copy', () => {
    // Two hand-maintained lists drift — that is half of why `publicSurface.ts`
    // exists (review R-V3-04).
    const disallow = disallowList()
    for (const prefix of NOINDEX_PREFIXES) expect(disallow).toContain(prefix)
  })
})
