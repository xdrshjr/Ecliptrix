import { NextRequest } from 'next/server'
import { backendConfig } from '@/lib/config/backend'

// Keep cancellation attached until playback stops, including after headers arrive.
export async function GET(request: NextRequest) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  const timer = setTimeout(abort, 300_000)
  const cleanup = () => {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
  }
  try {
    const upstream = await fetch(backendConfig.joinPath('/api/youtube/preview/stream') + request.nextUrl.search, {
      headers: request.headers.has('range') ? { Range: request.headers.get('range')! } : {},
      signal: controller.signal,
      cache: 'no-store',
    })
    const headers = new Headers()
    for (const name of ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control']) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    if (!upstream.body) {
      cleanup()
      return new Response(null, { status: upstream.status, headers })
    }
    const reader = upstream.body.getReader()
    const body = new ReadableStream({
      async pull(output) {
        try {
          const result = await reader.read()
          if (result.done) { cleanup(); output.close() }
          else output.enqueue(result.value)
        } catch (error) { cleanup(); output.error(error) }
      },
      async cancel() {
        abort()
        cleanup()
        await reader.cancel().catch(() => {})
      },
    })
    return new Response(body, { status: upstream.status, headers })
  } catch {
    cleanup()
    return Response.json({ code: 'NETWORK_ERROR' }, { status: request.signal.aborted ? 499 : 502 })
  }
}
