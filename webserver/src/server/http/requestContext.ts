import { randomUUID } from 'node:crypto'
import { CSRF_COOKIE, CSRF_HEADER } from '@/server/auth/constants'
import { AppError } from '@/server/http/errors'
import { errors } from '@/server/http/errors'
import { getConfig } from '@/server/config'

/**
 * Per-request context: the facts every log line and audit row wants, extracted
 * once at the boundary so no service has to reach into headers.
 */

export interface RequestContext {
  requestId: string
  ip: string
  userAgent: string
  /** Origin header when present; used by the CORS preflight. */
  origin: string | null
  csrfHeader: string | null
  csrfCookie: string | null
}

const FALLBACK_IP = '0.0.0.0'

/**
 * Client address from `X-Forwarded-For`, honouring TRUST_PROXY.
 *
 * Takes the LAST entry, not the first. `$proxy_add_x_forwarded_for` — the
 * idiomatic Nginx directive, and the one the sibling example config originally
 * shipped — APPENDS the peer address to whatever the client sent, so the first
 * entry is whatever the client chose to write. Reading it would hand the caller
 * control of every IP-keyed budget (login 20/5min, register 10/h, reset 3/h),
 * of the account-lockout accounting and of the `ip` field on every audit row.
 * The last entry is the one the nearest proxy filled in.
 *
 * Our own `deploy/nginx.conf.example` now sets `X-Forwarded-For $remote_addr`,
 * which makes both readings identical; taking the tail means a misconfigured
 * front end degrades to "wrong but not forgeable" instead of "trust anything".
 */
export function clientIpFrom(headers: Headers, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = headers.get('x-forwarded-for')
    if (forwarded) {
      const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean)
      const nearest = hops.at(-1)
      if (nearest) return nearest
    }
    const realIp = headers.get('x-real-ip')
    if (realIp) return realIp.trim()
  }
  return FALLBACK_IP
}

/** Raw cookie value without pulling in a dependency. */
export function readCookieFrom(headers: Headers, name: string): string | null {
  const raw = headers.get('cookie')
  if (!raw) return null
  for (const part of raw.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() !== name) continue
    const value = part.slice(index + 1).trim()
    return value ? decodeURIComponent(value) : null
  }
  return null
}

export function buildRequestContext(request: Request, requestId?: string): RequestContext {
  const config = getConfig()
  const headers = request.headers
  return {
    requestId: requestId ?? headers.get('x-request-id') ?? randomUUID(),
    ip: clientIpFrom(headers, config.trustProxy),
    userAgent: headers.get('user-agent') ?? '',
    origin: headers.get('origin'),
    csrfHeader: headers.get(CSRF_HEADER),
    csrfCookie: readCookieFrom(headers, CSRF_COOKIE),
  }
}

/**
 * Double-submit CSRF check for cookie-authenticated writes.
 *
 * Bearer requests are exempt by construction: an attacker's page cannot add an
 * Authorization header, so there is no confused-deputy problem to solve.
 */
export function assertCsrf(context: RequestContext): void {
  if (!context.csrfHeader || !context.csrfCookie) throw errors.csrf()
  if (context.csrfHeader !== context.csrfCookie) throw errors.csrf()
}

const REDACTED = '[redacted]'
const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'password_confirmation',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'sessionsecret',
  'invitecode',
  'resethash',
  'password_hash',
])

/**
 * Recursively replace secret-looking values before anything is logged.
 *
 * Deliberately key-based rather than value-based: a value-based filter would
 * have to guess, and the keys here are the only ones that carry credentials.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(source)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''))
        ? REDACTED
        : redact(entry, depth + 1)
    }
    return out
  }
  return value
}

export interface LogFields {
  [key: string]: unknown
}

/** One JSON line per event — container-friendly, no log framework needed. */
export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  fields: LogFields = {},
): void {
  const config = getConfig()
  const order = ['debug', 'info', 'warn', 'error'] as const
  if (order.indexOf(level) < order.indexOf(config.logLevel)) return
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(fields) as Record<string, unknown>),
  }
  const line = JSON.stringify(record)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * Wrap a route handler so that every throw becomes the shared envelope.
 *
 * Unknown errors are logged with the request id and answered as
 * `internal_error` with no stack trace or file path in the body.
 */
export function withRoute<Args extends unknown[]>(
  name: string,
  handler: (request: Request, context: RequestContext, ...args: Args) => Promise<Response>,
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const context = buildRequestContext(request)
    try {
      return await handler(request, context, ...args)
    } catch (error) {
      const { fail } = await import('@/server/http/envelope')
      if (error instanceof AppError) {
        log('warn', `${name} rejected`, {
          requestId: context.requestId,
          code: error.code,
          status: error.status,
          ip: context.ip,
        })
        return fail(error, context.requestId)
      }
      log('error', `${name} failed`, {
        requestId: context.requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      return fail(
        new AppError('internal_error', '服务器内部错误，请提供服务端 request-id 以便排查'),
        context.requestId,
      )
    }
  }
}
