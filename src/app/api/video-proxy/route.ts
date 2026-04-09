import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_HOSTS = [
  'ecliptrix.oss-cn-beijing.aliyuncs.com',
]

const UPSTREAM_TIMEOUT_MS = 60_000

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.some(
    host => hostname === host || hostname.endsWith('.' + host),
  )
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid url parameter' }, { status: 400 })
  }

  if (!isAllowedHost(parsedUrl.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 })
  }

  try {
    const headers: Record<string, string> = {}
    const range = request.headers.get('range')
    if (range) {
      headers['Range'] = range
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

    let upstream: Response
    try {
      upstream = await fetch(url, { headers, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }

    const responseHeaders = new Headers()
    const passThrough = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'cache-control',
    ]
    for (const h of passThrough) {
      const val = upstream.headers.get(h)
      if (val) responseHeaders.set(h, val)
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch video' }, { status: 502 })
  }
}
