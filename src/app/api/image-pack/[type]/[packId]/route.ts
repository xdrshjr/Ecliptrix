import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, DELETE } = createPassthroughRoute(
  (p) => `/api/image-pack/${p.type as string}/${p.packId as string}`,
)
