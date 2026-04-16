import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute(
  (p) => `/api/image-pack/${p.type as string}/list`,
)
