import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { PUT } = createPassthroughRoute(
  (p) => `/api/system-settings/${p.category as string}/${p.key as string}`,
)
