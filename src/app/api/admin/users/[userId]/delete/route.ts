import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { DELETE } = createPassthroughRoute(
  (p) => `/api/user/delete/${p.userId as string}`,
)
