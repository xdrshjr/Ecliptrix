import 'server-only'

/**
 * Backend proxy helper — single, dumb pipe used by every Next.js BFF route.
 *
 * SERVER-SIDE ONLY. Imports `server-only` so any accidental client import
 * crashes the build (matches the same constraint applied to `backendConfig`).
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/04-nextjs-routes-sweep.md
 *
 * Design summary:
 *  - The helper does NOT parse JSON, validate schemas, or re-shape data.
 *    It is a dumb pipe. Body shape mutation lives in client modules
 *    (`src/lib/api/*.ts`) per master plan §5.1.
 *  - Always forwards `Authorization` and the legacy `x-session-token`
 *    headers from the incoming request, so backend SessionAuthMiddleware
 *    (T01) sees the user identity on every proxied call.
 *  - Forwards multipart bodies untouched by streaming the raw request
 *    body (`req.body`) and forwarding the incoming `Content-Type` header
 *    (boundary intact) and `Content-Length` if present. This preserves
 *    `filename=...` attributes on file parts that would otherwise be
 *    dropped by re-encoding through `req.formData()` / undici on the way
 *    out of `fetch`.
 *  - Forwards JSON / text bodies as raw text and preserves Content-Type.
 *  - GET requests forward `?query=string` from the incoming URL.
 *  - On AbortError (timeout) returns 504 with a uniform timeout envelope.
 *  - On other fetch errors returns 502 with a uniform network envelope.
 *  - On non-JSON 4xx/5xx backend responses returns the original status with
 *    a uniform `BACKEND_ERROR` envelope. JSON backend responses are passed
 *    through with status preserved.
 *  - `streaming: true` short-circuits the buffered branch and returns the
 *    raw `ReadableStream` from the backend response. Used for downloads,
 *    SSE, and large file passthrough.
 *
 * Dynamic-route awareness (Next.js 15 App Router):
 *  - The 2nd argument can be a literal string OR a builder
 *    `(params) => string` that receives the resolved
 *    `ctx.params` object. The helper awaits `ctx.params` once
 *    internally before invoking the builder.
 *  - Routes under `[*]` segments MUST use the builder form so the
 *    Next-URL → backend-URL mapping is explicit at the call site
 *    (e.g. `/api/admin/users/[userId]/toggle-status` → backend
 *    `/api/user/toggle-status/${userId}` — note the rename).
 */

import type { NextRequest } from 'next/server'
import { backendConfig } from '@/lib/config/backend'

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Optional knobs for proxy behavior.
 */
export interface ProxyOptions {
  /** Additional headers from the incoming request to forward to the backend. */
  forwardHeaders?: string[]
  /** Per-request timeout (default 60_000 ms). */
  timeoutMs?: number
  /** When true, pipe the backend body through without buffering (SSE, downloads). */
  streaming?: boolean
  /**
   * Response-header allowlist for streaming responses. When set, ONLY headers
   * named in this list (case-insensitive) are forwarded to the client. When
   * unset, all backend response headers are forwarded as-is.
   *
   * Used by the `storage/files/[...path]` escape hatch which needs to expose
   * `content-range`/`accept-ranges` for video seeking but suppress backend
   * cookies and internal headers.
   */
  responseHeaderAllowlist?: string[]
}

/**
 * Either a literal backend path OR a builder that consumes resolved
 * dynamic-route params and returns the backend path.
 */
export type BackendPath =
  | string
  | ((params: Record<string, string | string[]>) => string)

/**
 * Next.js 15 App Router route context. `params` is a Promise that the
 * helper awaits exactly once before passing to the BackendPath builder.
 *
 * Next.js's generated `.next/types/app/api/.../route.ts` validators require
 * `params` to satisfy `Promise<any>` (not `undefined`), so the field is
 * declared non-optional here. Static (non-dynamic) routes still call the
 * exported handler with `ctx = {} as any` or with no value at all, and the
 * helper handles a missing `params` field defensively at runtime via
 * `ctx?.params`.
 */
export interface RouteContext {
  params: Promise<Record<string, string | string[]>>
}

/**
 * Uniform error envelope returned by the helper for backend failures and
 * proxy-level failures (timeout, network, non-JSON backend errors).
 *
 * Mirrors the backend `ErrorResponse` shape (`BaseResponse` + error fields)
 * so frontend clients see ONE error contract regardless of which layer
 * actually failed.
 */
export interface ProxyErrorEnvelope {
  success: false
  message: string
  error_code: 'BACKEND_TIMEOUT' | 'BACKEND_UNREACHABLE' | 'BACKEND_ERROR'
  error_details: Record<string, unknown> | null
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

async function resolveBackendPath(
  backendPath: BackendPath,
  ctx?: RouteContext,
): Promise<string> {
  if (typeof backendPath === 'string') {
    return backendPath
  }
  // Builder form — resolve params (if any) and call.
  const params = ctx?.params ? await ctx.params : {}
  return backendPath(params ?? {})
}

function buildForwardedHeaders(
  req: NextRequest,
  opts?: ProxyOptions,
): Headers {
  const headers = new Headers()

  // Always forward Authorization
  const auth = req.headers.get('authorization')
  if (auth) headers.set('Authorization', auth)

  // Always forward legacy x-session-token (kept for backwards compat per
  // master plan D8)
  const legacy = req.headers.get('x-session-token')
  if (legacy) headers.set('x-session-token', legacy)

  // Forward any explicitly-requested extras
  for (const name of opts?.forwardHeaders ?? []) {
    const value = req.headers.get(name)
    if (value !== null) headers.set(name, value)
  }

  return headers
}

function timeoutEnvelope(timeoutMs: number): ProxyErrorEnvelope {
  return {
    success: false,
    message: `Backend request timed out after ${timeoutMs}ms`,
    error_code: 'BACKEND_TIMEOUT',
    error_details: { timeoutMs },
  }
}

function networkEnvelope(error: unknown): ProxyErrorEnvelope {
  const message = error instanceof Error ? error.message : String(error)
  return {
    success: false,
    message: `Backend unreachable: ${message}`,
    error_code: 'BACKEND_UNREACHABLE',
    error_details: { cause: message },
  }
}

function nonJsonBackendErrorEnvelope(
  status: number,
  bodyPreview: string,
): ProxyErrorEnvelope {
  return {
    success: false,
    message: `Backend returned a non-JSON ${status} response`,
    error_code: 'BACKEND_ERROR',
    error_details: {
      status,
      body_preview: bodyPreview.slice(0, 500),
    },
  }
}

function looksLikeJson(contentType: string | null): boolean {
  if (!contentType) return false
  return contentType.toLowerCase().includes('application/json')
}

async function executeProxy(
  method: HttpMethod,
  req: NextRequest,
  backendPath: BackendPath,
  ctx?: RouteContext,
  opts?: ProxyOptions,
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // 1. Resolve dynamic params and build the target URL
  const resolvedPath = await resolveBackendPath(backendPath, ctx)
  let targetUrl = backendConfig.joinPath(resolvedPath)

  // 2. Forward query string. Originally GET-only; the storyboard project
  //    isolation work added DELETE + POST routes (``?project_id=...``) that
  //    rely on the BFF passing the query through verbatim, so it now applies
  //    to every method. Body precedence on POST/PUT is unchanged.
  {
    const qs = req.nextUrl.searchParams.toString()
    if (qs) targetUrl += (targetUrl.includes('?') ? '&' : '?') + qs
  }

  // 3. Build forwarded headers
  const headers = buildForwardedHeaders(req, opts)

  // 4. Forward body (only for non-GET)
  let body: BodyInit | null = null
  let isStreamBody = false
  if (method !== 'GET') {
    const incomingContentType = req.headers.get('content-type') ?? ''

    if (incomingContentType.toLowerCase().startsWith('multipart/form-data')) {
      // Multipart: stream the raw body through unchanged. We MUST forward
      // the incoming Content-Type (with its boundary) and Content-Length
      // (if present) so the upstream parser sees the same bytes the client
      // sent. Re-encoding via `req.formData()` drops `filename=` attributes
      // on file parts (Next.js 15 / undici behaviour) and breaks any
      // backend that reads `request.form()` and type-checks for
      // `UploadFile` (e.g. frame_pack_router.create_frame_pack).
      const reqWithBody = req as unknown as { body: ReadableStream | null }
      if (reqWithBody.body) {
        body = reqWithBody.body
        isStreamBody = true
      } else {
        // Defensive: if the runtime ever exposes no body stream, fall back
        // to the buffered FormData path so the request still goes through.
        body = await req.formData()
      }
      headers.set('Content-Type', incomingContentType)
      const incomingContentLength = req.headers.get('content-length')
      if (incomingContentLength) {
        headers.set('Content-Length', incomingContentLength)
      }
    } else if (incomingContentType) {
      // JSON / text / urlencoded: forward raw text + preserve Content-Type
      body = await req.text()
      headers.set('Content-Type', incomingContentType)
    } else {
      // No content-type: try text() defensively. Some DELETE calls send
      // an empty body with no content-type.
      const raw = await req.text()
      if (raw.length > 0) {
        body = raw
      }
    }
  }

  // 5. Issue the upstream call with AbortController-driven timeout
  const abortCtrl = new AbortController()
  const timeoutHandle = setTimeout(() => abortCtrl.abort(), timeoutMs)

  let backendResponse: Response
  try {
    const fetchInit: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      body,
      signal: abortCtrl.signal,
      // Hint to Next.js fetch instrumentation: don't cache proxied calls.
      cache: 'no-store',
    }
    // Node ≥ 18 fetch requires `duplex: 'half'` when the body is a
    // ReadableStream (one-shot send, no read-back). Without it undici
    // throws `TypeError: 'duplex' must be specified`.
    if (isStreamBody) {
      fetchInit.duplex = 'half'
    }
    backendResponse = await fetch(targetUrl, fetchInit)
  } catch (error: unknown) {
    clearTimeout(timeoutHandle)
    // AbortError → timeout
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      return new Response(JSON.stringify(timeoutEnvelope(timeoutMs)), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Anything else → network error envelope
    return new Response(JSON.stringify(networkEnvelope(error)), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  clearTimeout(timeoutHandle)

  // 6. Streaming pass-through — short-circuit before buffering the body
  if (opts?.streaming) {
    const responseHeaders = new Headers()
    if (opts.responseHeaderAllowlist && opts.responseHeaderAllowlist.length > 0) {
      const allow = new Set(
        opts.responseHeaderAllowlist.map((h) => h.toLowerCase()),
      )
      backendResponse.headers.forEach((value, key) => {
        if (allow.has(key.toLowerCase())) {
          responseHeaders.set(key, value)
        }
      })
    } else {
      backendResponse.headers.forEach((value, key) => {
        responseHeaders.set(key, value)
      })
    }
    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    })
  }

  // 7. Buffered pass-through (default)
  const backendContentType = backendResponse.headers.get('content-type')
  const bodyText = await backendResponse.text()

  // 7a. 4xx/5xx with JSON body → forward as-is with status preserved
  // 7b. 4xx/5xx with non-JSON body → wrap in BACKEND_ERROR envelope
  // 7c. 2xx → forward as-is
  if (!backendResponse.ok && !looksLikeJson(backendContentType)) {
    return new Response(
      JSON.stringify(nonJsonBackendErrorEnvelope(backendResponse.status, bodyText)),
      {
        status: backendResponse.status,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  return new Response(bodyText, {
    status: backendResponse.status,
    headers: {
      'Content-Type': backendContentType ?? 'application/json',
    },
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Low-level method-specific proxy primitives. Use this when a route needs
 * a single HTTP verb. Most callers should use `createPassthroughRoute`
 * instead — it's the same thing wrapped in the Next.js handler shape.
 */
export const backendProxy = {
  get(
    req: NextRequest,
    backendPath: BackendPath,
    ctx?: RouteContext,
    opts?: ProxyOptions,
  ): Promise<Response> {
    return executeProxy('GET', req, backendPath, ctx, opts)
  },
  post(
    req: NextRequest,
    backendPath: BackendPath,
    ctx?: RouteContext,
    opts?: ProxyOptions,
  ): Promise<Response> {
    return executeProxy('POST', req, backendPath, ctx, opts)
  },
  put(
    req: NextRequest,
    backendPath: BackendPath,
    ctx?: RouteContext,
    opts?: ProxyOptions,
  ): Promise<Response> {
    return executeProxy('PUT', req, backendPath, ctx, opts)
  },
  patch(
    req: NextRequest,
    backendPath: BackendPath,
    ctx?: RouteContext,
    opts?: ProxyOptions,
  ): Promise<Response> {
    return executeProxy('PATCH', req, backendPath, ctx, opts)
  },
  del(
    req: NextRequest,
    backendPath: BackendPath,
    ctx?: RouteContext,
    opts?: ProxyOptions,
  ): Promise<Response> {
    return executeProxy('DELETE', req, backendPath, ctx, opts)
  },
} as const

/**
 * Convenience builder: returns the four Next.js handler functions
 * (`GET`/`POST`/`PUT`/`DELETE`) for a single backend path. The route file
 * picks which methods it actually exports.
 *
 * Usage:
 *
 *   // Static route
 *   import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
 *   export const { POST } = createPassthroughRoute('/api/video/search')
 *
 *   // Dynamic route
 *   export const { POST } = createPassthroughRoute(
 *     (p) => `/api/user/toggle-status/${p.userId}`,
 *   )
 *
 *   // Long-running
 *   export const { POST } = createPassthroughRoute(
 *     '/api/video/compose',
 *     { timeoutMs: 600_000 },
 *   )
 *
 *   // Streaming
 *   export const { POST } = createPassthroughRoute(
 *     '/api/ai-video-script-generation',
 *     { streaming: true, timeoutMs: 300_000 },
 *   )
 */
export function createPassthroughRoute(
  backendPath: BackendPath,
  opts?: ProxyOptions,
) {
  return {
    GET: (req: NextRequest, ctx: RouteContext) =>
      backendProxy.get(req, backendPath, ctx, opts),
    POST: (req: NextRequest, ctx: RouteContext) =>
      backendProxy.post(req, backendPath, ctx, opts),
    PUT: (req: NextRequest, ctx: RouteContext) =>
      backendProxy.put(req, backendPath, ctx, opts),
    DELETE: (req: NextRequest, ctx: RouteContext) =>
      backendProxy.del(req, backendPath, ctx, opts),
  }
}
