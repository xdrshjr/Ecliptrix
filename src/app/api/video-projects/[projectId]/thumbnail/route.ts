import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute(
  (p) => `/api/video-projects/${encodeURIComponent(String(p.projectId))}/thumbnail`,
  {
    streaming: true,
    timeoutMs: 20000,
    abortOnClientDisconnect: true,
    responseHeaderAllowlist: [
      'content-type', 'cache-control', 'content-length', 'x-content-type-options',
    ],
  },
)
