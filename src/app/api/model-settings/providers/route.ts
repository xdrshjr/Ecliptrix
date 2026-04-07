import { createPassthroughRoute, backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

// GET hits a different backend path (`/known`); POST hits the base resource.
export function GET(req: NextRequest) {
  return backendProxy.get(req, '/api/model-settings/providers/known')
}

export const { POST } = createPassthroughRoute('/api/model-settings/providers')
