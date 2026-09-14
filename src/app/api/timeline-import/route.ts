import { createPassthroughRoute, backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

// POST = full import; PUT = validation-only (different backend path).
// AI auto edit waits up to 300 s for an import on the client; the proxy's
// 60 s default would cut a large plan off first (AM2-03).
export const { POST } = createPassthroughRoute('/api/timeline/import/upload', { timeoutMs: 300_000 })

export function PUT(req: NextRequest) {
  return backendProxy.post(req, '/api/timeline/validate')
}
