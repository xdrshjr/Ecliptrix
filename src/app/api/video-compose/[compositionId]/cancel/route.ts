import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// EXO-07 — cooperative cancel: the backend stops the composition at its next
// stage boundary and cleans up; 409 when it already settled, 404 when unknown.
export const { POST } = createPassthroughRoute(
  (p) => `/api/video/compose/${p.compositionId as string}/cancel`,
)
