import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Multipart proxy — fetch sets the boundary header itself; the helper
// re-encodes the FormData and forwards it untouched.
export const { POST } = createPassthroughRoute(
  (p) => `/api/video-cover/${p.projectId}/png-cache`,
  { timeoutMs: 120_000 },
)
