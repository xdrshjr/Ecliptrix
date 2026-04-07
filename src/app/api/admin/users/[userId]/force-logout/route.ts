import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute(
  (p) => `/api/user/force-logout/${p.userId as string}`,
)
