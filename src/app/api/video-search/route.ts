import { createPassthroughRoute, backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

// POST forwards search requests; GET hits the dedicated health endpoint.
export const { POST } = createPassthroughRoute('/api/video/search')

export function GET(req: NextRequest) {
  return backendProxy.get(req, '/api/video/search/health')
}
