import { createPassthroughRoute, backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

// POST = full import; PUT = validation-only (different backend path).
export const { POST } = createPassthroughRoute('/api/timeline/import/upload')

export function PUT(req: NextRequest) {
  return backendProxy.post(req, '/api/timeline/validate')
}
