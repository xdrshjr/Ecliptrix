import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — video cutting can take a few minutes for large files.
export const { POST } = createPassthroughRoute('/api/video/cut', {
  timeoutMs: 300_000,
})
