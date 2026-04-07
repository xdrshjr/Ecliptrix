import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — YouTube download + storage upload, can take many minutes.
export const { POST } = createPassthroughRoute('/api/youtube/download-and-upload', {
  timeoutMs: 600_000,
})
