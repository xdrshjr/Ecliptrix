import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — batch analysis can take a while across many videos.
export const { POST } = createPassthroughRoute('/api/video/batch-analyze', {
  timeoutMs: 600_000,
})
