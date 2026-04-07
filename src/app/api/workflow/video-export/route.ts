import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/workflow/video-export', {
  timeoutMs: 300_000,
})
