import { createPassthroughRoute, backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

// Audio search request POST + audio service health GET. The previous
// implementation MIXED `BACKEND_URL` (top-level) with `BACKEND_SERVICE_URL`
// (inside POST) — both reads collapse to `backendConfig.baseUrl` via the
// helper.
export const { POST } = createPassthroughRoute('/api/audio/search')

export function GET(req: NextRequest) {
  return backendProxy.get(req, '/api/audio/health')
}
