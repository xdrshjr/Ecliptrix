import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, PUT } = createPassthroughRoute(
  (p) => `/api/system-settings/${p.category as string}`,
)
