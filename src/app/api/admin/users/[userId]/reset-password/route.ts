import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute(
  (p) => `/api/user/reset-password/${p.userId as string}`,
)
