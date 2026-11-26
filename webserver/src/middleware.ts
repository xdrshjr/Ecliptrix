import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/server/auth/constants'
import { NOINDEX_PREFIXES } from '@/server/auth/publicSurface'

/**
 * Edge middleware.
 *
 * Two jobs only (spec §2.2 rule 4):
 *  1. attach security headers to every response;
 *  2. bounce obviously-unauthenticated visitors away from the console routes.
 *
 * It MUST NOT validate the session: `better-sqlite3` is a native module and Edge
 * has no access to it. The authority is `requireSession()` in the Node runtime;
 * this is a cheap redirect that saves a render, nothing more. A forged cookie
 * gets past this check and is rejected one layer down.
 */

const PROTECTED_PREFIXES = ['/account', '/admin']

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

/**
 * Routes whose URL carries a one-time token.
 *
 * `strict-origin-when-cross-origin` is NOT enough here: it still sends the full
 * URL on a SAME-origin navigation, so the token lands in our own access log or a
 * same-origin analytics request. These two pages get `no-referrer`, and
 * `deploy/nginx.conf.example` repeats the override because Nginx sets its own
 * header before the request reaches Node.
 */
const TOKEN_ROUTES = ['/verify-email', '/confirm-deletion']

/**
 * CSP kept deliberately close to Next's needs: inline styles are required by
 * Tailwind's runtime style injection and Next's dev overlay; scripts stay
 * self-only in production.
 */
function contentSecurityPolicy(isDev: boolean): string {
  const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'"
  return [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  const isDev = process.env.NODE_ENV !== 'production'

  const needsAuth = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value)

  if (needsAuth && !hasSessionCookie) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    const redirect = NextResponse.redirect(loginUrl)
    applySecurityHeaders(redirect, isDev, pathname)
    return redirect
  }

  const response = NextResponse.next()
  applySecurityHeaders(response, isDev, pathname)
  return response
}

function applySecurityHeaders(response: NextResponse, isDev: boolean, pathname = ''): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value)
  }
  if (TOKEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    response.headers.set('Referrer-Policy', 'no-referrer')
  }
  // Account and console pages must never be indexed, and the list comes from
  // `publicSurface.ts` so the header, `robots.ts` and the guest-surface test
  // cannot drift apart (review R-V3-04: this module was written but never wired).
  if (NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  }
  response.headers.set('Content-Security-Policy', contentSecurityPolicy(isDev))
  if (!isDev) {
    // HSTS only when the deployment is actually behind TLS; Nginx terminates it
    // in front of this process, so the header is set here for completeness.
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the API surface: API handlers set
     * their own headers and must not be redirected to /login.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
