import { backendProxy } from '@/lib/api/server/backend-proxy'
import type { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  return backendProxy.get(req, '/api/user/me/preferences')
}

export async function PATCH(req: NextRequest) {
  return backendProxy.patch(req, '/api/user/me/preferences')
}
