import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, DELETE } = createPassthroughRoute(
  (p) => `/api/frame-pack/${p.packId as string}`,
)
