import type { NextResponse } from 'next/server'
import { ZodError, type ZodTypeAny, type z } from 'zod'
import { AppError } from '@/server/http/errors'
import { ERROR_CODE, REQUEST_ID_HEADER } from '@/server/auth/constants'
import { fail, ok } from '@/server/http/envelope'
import { fieldErrors } from '@/server/validation/schemas'
import { buildRequestContext, log, type RequestContext } from '@/server/http/requestContext'
import { getConfig } from '@/server/config'

/**
 * Route plumbing shared by every `/api/v1` handler.
 *
 * Each handler gets: a request context, a parsed body when it declares a schema,
 * and the shared envelope on both success and failure. Nothing about HTTP status
 * codes leaks into services.
 */

export interface RouteDeps {
  request: Request
  context: RequestContext
  searchParams: URLSearchParams
}

type Handler = (deps: RouteDeps) => Promise<NextResponse> | NextResponse

const MAX_BODY_BYTES = 64 * 1024

/**
 * Run the lazy housekeeping sweep without awaiting it.
 *
 * `next start` has no resident worker, so the "execute overdue deletions" step
 * rides on the request path. It is fired AFTER the response is produced and is not
 * awaited: the caller must never wait for another account's deletion, and
 * `sweepIfDue` swallows its own failures.
 */
function scheduleSweep(): void {
  void (async () => {
    try {
      const { sweepIfDue } = await import('@/server/services/maintenanceService')
      sweepIfDue()
    } catch {
      // Never a request concern; the sweep logs its own problems.
    }
  })()
}

export function withContext(handler: Handler): (request: Request) => Promise<NextResponse> {
  return async (request: Request): Promise<NextResponse> => {
    const context = buildRequestContext(request)
    try {
      // Every API entry point passes through here, so this is the one place the
      // boot sequence has to be triggered for the request path.
      const { ensureBooted } = await import('@/server/boot')
      await ensureBooted()
      const response = await handler({
        request,
        context,
        searchParams: new URL(request.url).searchParams,
      })
      // Spec §4.1: every response carries the id, not just the failures. A `200`
      // that cannot be matched to a log line makes the id pointless for exactly
      // the case people need it — "it worked, but not the way I expected".
      response.headers.set(REQUEST_ID_HEADER, context.requestId)
      scheduleSweep()
      return response
    } catch (error) {
      if (error instanceof AppError) {
        log('warn', 'request rejected', {
          requestId: context.requestId,
          code: error.code,
          status: error.status,
          path: new URL(request.url).pathname,
        })
        return fail(error, context.requestId)
      }
      log('error', 'request failed', {
        requestId: context.requestId,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      })
      return fail(
        new AppError(ERROR_CODE.internalError, '服务器内部错误，请附带 request-id 联系管理员'),
        context.requestId,
      )
    }
  }
}

/**
 * Read and validate a JSON body.
 *
 * @throws {AppError} `invalid_request` for unparseable/oversized bodies,
 *         `validation_failed` (with per-field details) for schema failures.
 */
export async function readJson<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new AppError(ERROR_CODE.payloadTooLarge, '请求体过大')
  }
  if (!text.trim()) {
    throw new AppError(ERROR_CODE.invalidRequest, '请求体不能为空')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AppError(ERROR_CODE.invalidRequest, '请求体不是合法 JSON')
  }
  try {
    return schema.parse(parsed) as z.infer<TSchema>
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(ERROR_CODE.validationFailed, '请求参数校验失败', {
        details: { fields: fieldErrors(error) },
      })
    }
    throw error
  }
}

/** Same, but tolerates an absent body and returns schema defaults. */
export async function readOptionalJson<TSchema extends ZodTypeAny>(
  request: Request,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const text = await request.clone().text()
  if (!text.trim()) {
    try {
      return schema.parse({}) as z.infer<TSchema>
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError(ERROR_CODE.validationFailed, '请求参数校验失败', {
          details: { fields: fieldErrors(error) },
        })
      }
      throw error
    }
  }
  return readJson(request, schema)
}

/**
 * Validate the query string against a schema.
 *
 * The list endpoints used to read `searchParams.get(...)` and *drop* anything
 * unexpected, so `?status=sentt` silently returned every row instead of a `422`,
 * and an unbounded `?template=` reached the repository. A schema also gives the
 * caller the same `details.fields` shape the console already renders for bodies.
 *
 * Missing keys come through as `undefined` (not `''`), so optional fields stay
 * optional and defaults apply.
 */
export function readSearch<TSchema extends ZodTypeAny>(
  searchParams: URLSearchParams,
  schema: TSchema,
): z.infer<TSchema> {
  const raw: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (value !== '') raw[key] = value
  }
  try {
    return schema.parse(raw) as z.infer<TSchema>
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError(ERROR_CODE.validationFailed, '请求参数校验失败', {
        details: { fields: fieldErrors(error) },
      })
    }
    throw error
  }
}

export { ok }

/** CORS preflight answer for the desktop client (which sends no Origin). */
export function preflight(context: RequestContext): Response {
  const config = getConfig()
  const allowed = context.origin
    ? config.corsAllowedOrigins.includes(context.origin)
      ? context.origin
      : ''
    : config.corsAllowedOrigins[0] ?? ''
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-CSRF-Token,X-Request-Id',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  })
  if (allowed) headers.set('Access-Control-Allow-Origin', allowed)
  return new Response(null, { status: 204, headers })
}
