import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute(
  (p) => `/api/silence/status/${p.taskId as string}`,
)
