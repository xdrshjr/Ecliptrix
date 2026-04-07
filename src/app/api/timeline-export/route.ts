import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — timeline export may take a while for large projects.
export const { POST } = createPassthroughRoute('/api/timeline/export', {
  timeoutMs: 300_000,
})
