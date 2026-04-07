import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — batch storyboard video generation is long-running.
export const { POST } = createPassthroughRoute('/api/storyboard/batch-video', {
  timeoutMs: 600_000,
})
