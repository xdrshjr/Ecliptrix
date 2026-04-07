import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — image-to-video conversion can take a few minutes.
export const { POST } = createPassthroughRoute('/api/video/image-to-video', {
  timeoutMs: 300_000,
})
