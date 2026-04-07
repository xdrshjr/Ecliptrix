import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute(
  (p) => `/api/system-settings/${p.category as string}/reset`,
)
