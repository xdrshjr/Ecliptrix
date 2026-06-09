import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// List persisted poster + filmstrip frames for a material
// (local-video-editing-refactor spec 03). Consumed by the filmstrip cache
// pre-warm path.
export const { GET } = createPassthroughRoute(
  (p) => `/api/storage/thumbnails/${p.material_id as string}`,
)
