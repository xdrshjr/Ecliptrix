import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute(
  (p) => `/api/ark-video/status/${p.taskId as string}`,
)
