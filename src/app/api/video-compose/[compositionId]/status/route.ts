import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute(
  (p) => `/api/video/compose/${p.compositionId as string}/status`,
)
