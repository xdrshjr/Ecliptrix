import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — batch analysis can take a while across many videos. A client
// that cancels stops the remaining vision-model calls too (AM2-04).
export const { POST } = createPassthroughRoute('/api/video/batch-analyze', {
  timeoutMs: 600_000,
  abortOnClientDisconnect: true,
})
