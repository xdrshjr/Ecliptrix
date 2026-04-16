import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/storyboard/revise-script', {
  timeoutMs: 180_000,
})
