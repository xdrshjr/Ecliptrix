import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { PUT, DELETE } = createPassthroughRoute(
  (p) => `/api/video-projects/categories/${p.categoryId}`,
)
