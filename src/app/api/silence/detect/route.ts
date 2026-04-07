import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — silence detection runs FFmpeg on the backend.
export const { POST } = createPassthroughRoute('/api/silence/detect', {
  timeoutMs: 300_000,
})
