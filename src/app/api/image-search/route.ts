import { createPassthroughRoute, backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

// Previously mixed BACKEND_URL (top-level) with BACKEND_SERVICE_URL (inside
// POST). Both collapse to `backendConfig.baseUrl` via the helper.
export const { POST } = createPassthroughRoute('/api/image/search')

export function GET(req: NextRequest) {
  return backendProxy.get(req, '/api/image/health')
}
