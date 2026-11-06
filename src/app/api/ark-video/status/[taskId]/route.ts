import { NextRequest } from 'next/server'
import { backendProxy, type RouteContext } from '@/lib/api/server/backend-proxy'

export async function GET(req: NextRequest, ctx: RouteContext) {
  const url = req.nextUrl.clone()
  const retry = url.searchParams.get('retry_artifact')
  url.search = ''
  if (retry === 'true') url.searchParams.set('retry_artifact', 'true')
  const filtered = new NextRequest(url, { headers: req.headers })
  return backendProxy.get(filtered, (p) => `/api/ark-video/status/${encodeURIComponent(p.taskId as string)}`, ctx, { timeoutMs: 25000 })
}
