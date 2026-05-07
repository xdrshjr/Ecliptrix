/**
 * Unit tests for the backend proxy helper.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/04-nextjs-routes-sweep.md §6
 *
 * Cases T1–T20 from the spec test matrix. Each case mocks `global.fetch`
 * and constructs a minimal `NextRequest`-shaped object that exposes only
 * the surface the helper actually reads (`headers`, `nextUrl.searchParams`,
 * `text()`, `formData()`).
 *
 * Test runner: Vitest. Vitest is NOT installed yet — installation lands in
 * T07. Until then this file is dormant valid syntax (same posture as the
 * T02/T03 test files in `src/lib/config/__tests__/` and
 * `src/lib/api/__tests__/`).
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Sentinel to satisfy backend.ts's eager throw — must run before importing.
process.env.BACKEND_URL = 'http://test-backend:8088'

// Stub server-only so the import resolves cleanly under Vitest's Node env.
// (Real production builds resolve `server-only` via Next.js bundling.)
vi.mock('server-only', () => ({}))

import { backendProxy, createPassthroughRoute } from '../backend-proxy'
import type { BackendPath, RouteContext } from '../backend-proxy'

// ───────────────────────────────────────────────────────────────────────────
// Test helpers
// ───────────────────────────────────────────────────────────────────────────

interface FakeRequestInit {
  url?: string
  headers?: Record<string, string>
  body?: string | FormData | ReadableStream | Uint8Array | null
}

/** Build a minimal NextRequest-shaped object exposing the surface the
 *  helper reads. */
function makeRequest(init: FakeRequestInit = {}): any {
  const url = init.url ?? 'http://localhost:3000/api/test?a=1&b=2'
  const headersInit = init.headers ?? {}
  const headers = new Headers(headersInit)
  let bodyStream: ReadableStream | null = null
  if (init.body instanceof ReadableStream) {
    bodyStream = init.body
  } else if (init.body instanceof Uint8Array) {
    const bytes = init.body
    bodyStream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
  }
  return {
    headers,
    nextUrl: new URL(url),
    body: bodyStream,
    text: async () => {
      if (init.body == null) return ''
      if (typeof init.body === 'string') return init.body
      return ''
    },
    formData: async () => {
      if (init.body instanceof FormData) return init.body
      return new FormData()
    },
  }
}

/** Build a fake fetch Response with given status / json / contentType. */
function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string } = {},
): Response {
  const status = init.status ?? 200
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.useRealTimers()
})

// ───────────────────────────────────────────────────────────────────────────
// T1: GET request, mocked backend returns 200 JSON
// ───────────────────────────────────────────────────────────────────────────
describe('T1 — GET happy path', () => {
  it('returns 200 with same body and forwards method GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [1, 2, 3] }))
    const req = makeRequest({ url: 'http://localhost:3000/api/test' })

    const res = await backendProxy.get(req, '/api/video/search')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, data: [1, 2, 3] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe('http://test-backend:8088/api/video/search')
    expect(calledOpts.method).toBe('GET')
    expect(calledOpts.body).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T2: POST with JSON body
// ───────────────────────────────────────────────────────────────────────────
describe('T2 — POST with JSON body', () => {
  it('forwards stringified JSON and preserves Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ created: true }))
    const req = makeRequest({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 1, y: 'two' }),
    })

    const res = await backendProxy.post(req, '/api/video/compose')

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe('http://test-backend:8088/api/video/compose')
    expect(calledOpts.method).toBe('POST')
    expect(calledOpts.body).toBe('{"x":1,"y":"two"}')
    expect((calledOpts.headers as Headers).get('Content-Type')).toBe(
      'application/json',
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T3: POST with FormData (multipart)
// ───────────────────────────────────────────────────────────────────────────
describe('T3 — POST with multipart streams body unchanged', () => {
  it('streams req.body, preserves the incoming boundary, sets duplex:half, and survives a filename round-trip', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ uploaded: true }))
    // Construct a real multipart body with a frame_001 part carrying a
    // filename attribute. We hand this to the proxy as a raw byte stream
    // — the same shape NextRequest exposes to the helper for an inbound
    // browser upload — and assert the upstream fetch saw the bytes
    // verbatim with the original Content-Type header.
    const boundary = '----abc1234'
    const crlf = '\r\n'
    const partHeader =
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="frame_001"; filename="frame_001.jpg"${crlf}` +
      `Content-Type: image/jpeg${crlf}${crlf}`
    const partFooter = `${crlf}--${boundary}--${crlf}`
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const headerBytes = new TextEncoder().encode(partHeader)
    const footerBytes = new TextEncoder().encode(partFooter)
    const totalLen = headerBytes.length + jpegBytes.length + footerBytes.length
    const bodyBytes = new Uint8Array(totalLen)
    bodyBytes.set(headerBytes, 0)
    bodyBytes.set(jpegBytes, headerBytes.length)
    bodyBytes.set(footerBytes, headerBytes.length + jpegBytes.length)

    const req = makeRequest({
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(totalLen),
      },
      body: bodyBytes,
    })

    const res = await backendProxy.post(req, '/api/frame-pack/create')

    expect(res.status).toBe(200)
    const [, calledOpts] = fetchMock.mock.calls[0]
    // Body must be the raw stream (NOT a re-encoded FormData)
    expect(calledOpts.body).toBeInstanceOf(ReadableStream)
    // Original Content-Type with intact boundary forwarded as-is
    expect((calledOpts.headers as Headers).get('Content-Type')).toBe(
      `multipart/form-data; boundary=${boundary}`,
    )
    // Content-Length forwarded
    expect((calledOpts.headers as Headers).get('Content-Length')).toBe(
      String(totalLen),
    )
    // Streaming a request body in Node fetch requires duplex: 'half'
    expect(calledOpts.duplex).toBe('half')

    // Round-trip: drain the forwarded stream and assert the filename
    // attribute survived.
    const reader = (calledOpts.body as ReadableStream).getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value as Uint8Array)
    }
    const totalForwarded = chunks.reduce((n, c) => n + c.length, 0)
    const flat = new Uint8Array(totalForwarded)
    let off = 0
    for (const c of chunks) {
      flat.set(c, off)
      off += c.length
    }
    const decoded = new TextDecoder().decode(flat)
    expect(decoded).toContain('filename="frame_001.jpg"')
    expect(decoded).toContain('name="frame_001"')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T4: Incoming Authorization header
// ───────────────────────────────────────────────────────────────────────────
describe('T4 — forwards Authorization header', () => {
  it('forwards Authorization: Bearer xyz to backend', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const req = makeRequest({
      headers: { authorization: 'Bearer abc123' },
    })

    await backendProxy.get(req, '/api/video/search')

    const [, calledOpts] = fetchMock.mock.calls[0]
    expect((calledOpts.headers as Headers).get('Authorization')).toBe(
      'Bearer abc123',
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T5: Incoming x-session-token header
// ───────────────────────────────────────────────────────────────────────────
describe('T5 — forwards x-session-token (legacy header)', () => {
  it('forwards x-session-token to backend', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const req = makeRequest({
      headers: { 'x-session-token': 'legacy-token-zzz' },
    })

    await backendProxy.get(req, '/api/video/search')

    const [, calledOpts] = fetchMock.mock.calls[0]
    expect((calledOpts.headers as Headers).get('x-session-token')).toBe(
      'legacy-token-zzz',
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T6: No incoming auth headers
// ───────────────────────────────────────────────────────────────────────────
describe('T6 — does not invent fake auth headers', () => {
  it('omits Authorization and x-session-token when absent', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const req = makeRequest()

    await backendProxy.get(req, '/api/video/search')

    const [, calledOpts] = fetchMock.mock.calls[0]
    expect((calledOpts.headers as Headers).get('Authorization')).toBeNull()
    expect((calledOpts.headers as Headers).get('x-session-token')).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T7: forwardHeaders option
// ───────────────────────────────────────────────────────────────────────────
describe('T7 — forwardHeaders option', () => {
  it('forwards explicitly-listed extra headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const req = makeRequest({
      headers: { 'x-request-id': 'req-42', 'x-trace-id': 'trace-99' },
    })

    await backendProxy.get(req, '/api/foo', undefined, {
      forwardHeaders: ['x-request-id'],
    })

    const [, calledOpts] = fetchMock.mock.calls[0]
    expect((calledOpts.headers as Headers).get('x-request-id')).toBe('req-42')
    // x-trace-id was NOT in the allowlist
    expect((calledOpts.headers as Headers).get('x-trace-id')).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T8: Backend returns 401
// ───────────────────────────────────────────────────────────────────────────
describe('T8 — backend 401 forwarded', () => {
  it('returns 401 with the same JSON body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          message: 'Authentication required',
          error_code: 'UNAUTHORIZED',
        },
        { status: 401 },
      ),
    )
    const req = makeRequest()

    const res = await backendProxy.get(req, '/api/video/search')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error_code).toBe('UNAUTHORIZED')
    expect(body.message).toBe('Authentication required')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T9: Backend returns 500 with JSON body
// ───────────────────────────────────────────────────────────────────────────
describe('T9 — backend 500 with JSON body forwarded', () => {
  it('returns 500 with body intact', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          message: 'Database is on fire',
          error_code: 'DB_ERROR',
          error_details: { sql: 'SELECT *' },
        },
        { status: 500 },
      ),
    )
    const req = makeRequest()

    const res = await backendProxy.get(req, '/api/video/search')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error_code).toBe('DB_ERROR')
    expect(body.error_details.sql).toBe('SELECT *')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T10: Backend returns non-JSON 500 (e.g., HTML)
// ───────────────────────────────────────────────────────────────────────────
describe('T10 — backend 500 with non-JSON body wrapped in BACKEND_ERROR', () => {
  it('wraps in uniform envelope when content-type is text/html', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html><body>500 Internal Server Error</body></html>', {
        status: 500,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const req = makeRequest()

    const res = await backendProxy.get(req, '/api/video/search')

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error_code).toBe('BACKEND_ERROR')
    expect(body.error_details.status).toBe(500)
    expect(body.error_details.body_preview).toContain('500 Internal Server Error')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T11: Backend timeout
// ───────────────────────────────────────────────────────────────────────────
describe('T11 — timeout returns 504 envelope', () => {
  it('returns 504 with BACKEND_TIMEOUT envelope when fetch aborts', async () => {
    // Simulate AbortError
    fetchMock.mockImplementationOnce(() => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })
    const req = makeRequest()

    const res = await backendProxy.get(req, '/api/slow', undefined, {
      timeoutMs: 100,
    })

    expect(res.status).toBe(504)
    const body = await res.json()
    expect(body.error_code).toBe('BACKEND_TIMEOUT')
    expect(body.error_details.timeoutMs).toBe(100)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T12: Network error (fetch throws)
// ───────────────────────────────────────────────────────────────────────────
describe('T12 — network error returns 502 envelope', () => {
  it('returns 502 with BACKEND_UNREACHABLE envelope when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed: ECONNREFUSED'))
    const req = makeRequest()

    const res = await backendProxy.get(req, '/api/foo')

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error_code).toBe('BACKEND_UNREACHABLE')
    expect(body.message).toContain('ECONNREFUSED')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T13: streaming: true
// ───────────────────────────────────────────────────────────────────────────
describe('T13 — streaming pass-through', () => {
  it('returns the backend ReadableStream without buffering', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('chunk1\n'))
        controller.enqueue(encoder.encode('chunk2\n'))
        controller.close()
      },
    })
    fetchMock.mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    const req = makeRequest()

    const res = await backendProxy.post(req, '/api/stream', undefined, {
      streaming: true,
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toBe('chunk1\nchunk2\n')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T14: timeoutMs respected
// ───────────────────────────────────────────────────────────────────────────
describe('T14 — long timeoutMs honored', () => {
  it('does not abort when given a 600s timeout and a fast response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ done: true }))
    const req = makeRequest({
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

    const res = await backendProxy.post(req, '/api/video/compose', undefined, {
      timeoutMs: 600_000,
    })

    expect(res.status).toBe(200)
    // Verify the AbortController signal was NOT triggered (response made it back)
    const [, calledOpts] = fetchMock.mock.calls[0]
    expect((calledOpts.signal as AbortSignal).aborted).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T15: GET query string forwarding
// ───────────────────────────────────────────────────────────────────────────
describe('T15 — GET preserves query string', () => {
  it('appends ?foo=bar&baz=qux to backend URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const req = makeRequest({
      url: 'http://localhost:3000/api/video-search?foo=bar&baz=qux',
    })

    await backendProxy.get(req, '/api/video/search')

    const [calledUrl] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe(
      'http://test-backend:8088/api/video/search?foo=bar&baz=qux',
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T16: DELETE with body
// ───────────────────────────────────────────────────────────────────────────
describe('T16 — DELETE forwards body', () => {
  it('forwards JSON body and method=DELETE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: true }))
    const req = makeRequest({
      headers: { 'content-type': 'application/json' },
      body: '{"id":"abc"}',
    })

    const res = await backendProxy.del(req, '/api/widget')

    expect(res.status).toBe(200)
    const [, calledOpts] = fetchMock.mock.calls[0]
    expect(calledOpts.method).toBe('DELETE')
    expect(calledOpts.body).toBe('{"id":"abc"}')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T17: Two parallel calls to the same route
// ───────────────────────────────────────────────────────────────────────────
describe('T17 — parallel calls have independent AbortControllers', () => {
  it('does not cross-talk: aborting one does not affect the other', async () => {
    let firstSignal: AbortSignal | undefined
    let secondSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce(async (_url: unknown, opts: any) => {
      firstSignal = opts.signal
      return jsonResponse({ first: true })
    })
    fetchMock.mockImplementationOnce(async (_url: unknown, opts: any) => {
      secondSignal = opts.signal
      return jsonResponse({ second: true })
    })

    const req1 = makeRequest()
    const req2 = makeRequest()

    const [r1, r2] = await Promise.all([
      backendProxy.get(req1, '/api/foo'),
      backendProxy.get(req2, '/api/foo'),
    ])

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(firstSignal).toBeDefined()
    expect(secondSignal).toBeDefined()
    // Different AbortController instances → not the same signal reference
    expect(firstSignal).not.toBe(secondSignal)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T18: Builder BackendPath form with awaited ctx.params
// ───────────────────────────────────────────────────────────────────────────
describe('T18 — builder BackendPath resolves dynamic params', () => {
  it('awaits ctx.params and feeds them to the builder', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ toggled: true }))
    const req = makeRequest({
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const builder: BackendPath = (p) =>
      `/api/user/toggle-status/${p.userId as string}`
    const ctx: RouteContext = {
      params: Promise.resolve({ userId: 'u-abc-123' }),
    }

    await backendProxy.post(req, builder, ctx)

    const [calledUrl] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe(
      'http://test-backend:8088/api/user/toggle-status/u-abc-123',
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T19: Catch-all [...path] builder
// ───────────────────────────────────────────────────────────────────────────
describe('T19 — catch-all builder joins segments', () => {
  it('feeds resolved segment array into builder and joins with /', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('binary-bytes', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    )
    // No query string on the inbound URL — this test exercises the dynamic
    // builder, NOT query forwarding (which is covered by T15).
    const req = makeRequest({ url: 'http://localhost:3000/api/test' })
    const builder: BackendPath = (p) =>
      `/api/storage/files/${(p.path as string[]).join('/')}`
    const ctx: RouteContext = {
      params: Promise.resolve({ path: ['users', '42', 'avatar.jpg'] }),
    }

    const res = await backendProxy.get(req, builder, ctx)

    expect(res.status).toBe(200)
    const [calledUrl] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe(
      'http://test-backend:8088/api/storage/files/users/42/avatar.jpg',
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// T20: Static string BackendPath with ctx undefined
// ───────────────────────────────────────────────────────────────────────────
describe('T20 — static string BackendPath, undefined ctx', () => {
  it('uses literal path with no params resolution', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    // No query string on the inbound URL — T20 verifies the literal-path
    // branch, not query forwarding (covered by T15).
    const req = makeRequest({ url: 'http://localhost:3000/api/test' })

    const res = await backendProxy.get(req, '/api/health', undefined)

    expect(res.status).toBe(200)
    const [calledUrl] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe('http://test-backend:8088/api/health')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Bonus: createPassthroughRoute returns a usable handler shape
// ───────────────────────────────────────────────────────────────────────────
describe('createPassthroughRoute — returns Next.js handler shape', () => {
  it('exposes GET/POST/PUT/DELETE handlers', () => {
    const route = createPassthroughRoute('/api/foo')
    expect(typeof route.GET).toBe('function')
    expect(typeof route.POST).toBe('function')
    expect(typeof route.PUT).toBe('function')
    expect(typeof route.DELETE).toBe('function')
  })

  it('passes opts through (timeoutMs honored)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const route = createPassthroughRoute('/api/foo', { timeoutMs: 600_000 })
    const req = makeRequest({
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const res = await route.POST(req, {} as RouteContext)
    expect(res.status).toBe(200)
  })
})
