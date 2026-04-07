import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — long-running AI mixed editing.
export const { POST } = createPassthroughRoute('/api/ai-mixed-editing', {
  timeoutMs: 600_000,
})
