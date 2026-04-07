import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, DELETE } = createPassthroughRoute(
  (p) => `/api/storyboard/packs/${p.packId as string}`,
)
