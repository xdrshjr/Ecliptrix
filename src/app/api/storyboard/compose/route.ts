import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — storyboard composition includes video assembly.
export const { POST } = createPassthroughRoute('/api/storyboard/compose', {
  timeoutMs: 600_000,
})
