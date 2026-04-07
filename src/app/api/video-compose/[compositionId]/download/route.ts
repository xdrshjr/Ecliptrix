import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern D — large file download. Stream the body without buffering and
// allow up to 10 minutes for the backend to deliver the bytes. The proxy
// helper forwards the backend response headers (Content-Type,
// Content-Length, Content-Disposition, Accept-Ranges, etc.) untouched.
export const { GET } = createPassthroughRoute(
  (p) => `/api/video/compose/${p.compositionId as string}/download`,
  { streaming: true, timeoutMs: 600_000 },
)
