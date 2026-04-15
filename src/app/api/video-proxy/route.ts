import { NextRequest, NextResponse } from 'next/server'

// Strict whitelist. Every entry must be an explicit host (or a receiving-side
// subdomain match via `.<host>`). Do NOT add top-level company domains such as
// `volces.com` or `bytedance.com` — that would turn this route into an open
// proxy. Keep this list short (≤3) and document the source for each entry.
const ALLOWED_HOSTS = [
  // Our own OSS bucket (final storage after ffmpeg + upload finishes).
  'ecliptrix.oss-cn-beijing.aliyuncs.com',
  // ByteDance ARK video generation CDN — used for the temporary video_url
  // returned by the ARK SDK before the backend finishes uploading to OSS.
  // Source: ark_video_service.py populates `_cdn_urls[...]['video_url']`
  // directly from the ARK response `content.video_url`.
  'ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com',
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
