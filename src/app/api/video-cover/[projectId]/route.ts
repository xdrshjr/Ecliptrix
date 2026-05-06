import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// BFF for the per-project video cover authoring state. Auth is auto-forwarded
// via session cookie / x-session-token by the shared proxy helper. Default
// runtime is nodejs (Edge cannot read process.env.BACKEND_URL).
export const { GET, PUT, DELETE } = createPassthroughRoute(
  (p) => `/api/video-cover/${p.projectId}`,
)
