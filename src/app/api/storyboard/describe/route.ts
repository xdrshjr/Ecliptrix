import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/storyboard/describe', {
  timeoutMs: 120_000,
})
