import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — watermark removal is video processing, can take minutes.
export const { POST } = createPassthroughRoute('/api/video/watermark-removal', {
  timeoutMs: 600_000,
})
