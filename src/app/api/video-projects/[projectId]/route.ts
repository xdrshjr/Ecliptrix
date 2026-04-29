import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, PUT, DELETE } = createPassthroughRoute(
  (p) => `/api/video-projects/${p.projectId}`,
)
