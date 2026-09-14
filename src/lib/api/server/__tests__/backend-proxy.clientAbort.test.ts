/**
 * @vitest-environment node
 *
 * backend-proxy — a client that disconnects stops the upstream call (AM2-04, T93).
 *
 * Next 15 aborts `req.signal` when the browser closes the socket. Routes whose
 * backend work is long and cancellable opt in with `abortOnClientDisconnect`;
 * the proxy then aborts its own upstream fetch so the backend sees the
 * disconnect and stops (the backend side cancels on `http.disconnect`).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.BACKEND_URL = 'http://test-backend:8088'
vi.mock('server-only', () => ({}))

import { backendProxy } from '../backend-proxy'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

/** Minimal NextRequest-shaped object carrying a client abort signal. */
function jsonRequest(signal: AbortSignal) {
  return {
    headers: new Headers({ 'content-type': 'application/json' }),
    nextUrl: new URL('http://localhost:3000/api/ai-mixed-editing'),
    body: null,
    signal,
    text: async () => '{}',
    formData: async () => new FormData(),
  } as never
}

/** An upstream call that only ends when its own signal aborts. */
function upstreamUntilAborted(): { signal: () => AbortSignal | undefined } {
  let upstreamSignal: AbortSignal | undefined
  fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
    upstreamSignal = init.signal ?? undefined
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('This operation was aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
  })
  return { signal: () => upstreamSignal }
}

describe('backend-proxy client disconnect', () => {
  it('aborts the upstream fetch when the client disconnects and the route opts in', async () => {
    const client = new AbortController()
    const upstream = upstreamUntilAborted()

    const pending = backendProxy.post(jsonRequest(client.signal), '/api/ai-mixed-editing', undefined, {
      timeoutMs: 600_000,
      abortOnClientDisconnect: true,
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    client.abort()
    const response = await pending

    expect({ status: response.status, upstreamAborted: upstream.signal()?.aborted })
      .toEqual({ status: 499, upstreamAborted: true })
  })

  it('leaves the upstream call alone when the route does not opt in', async () => {
    const client = new AbortController()
    let upstreamSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined
      client.abort()
      return new Response('{"success":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const response = await backendProxy.post(jsonRequest(client.signal), '/api/video/search')

    expect({ status: response.status, upstreamAborted: upstreamSignal?.aborted })
      .toEqual({ status: 200, upstreamAborted: false })
  })

  it('the AI mix, batch analysis and timeline import routes opt in', () => {
    const routes = [
      'src/app/api/ai-mixed-editing/route.ts',
      'src/app/api/video/batch-analyze/route.ts',
      'src/app/api/timeline-import/route.ts',
    ]
    const optedIn = routes.filter((route) =>
      readFileSync(resolve(process.cwd(), route), 'utf8').includes('abortOnClientDisconnect: true'),
    )

    expect(optedIn).toEqual(routes)
  })
})
