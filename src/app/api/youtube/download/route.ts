import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — YouTube download can take a few minutes for large videos.
export const { POST } = createPassthroughRoute('/api/youtube/download', {
  timeoutMs: 600_000,
})
