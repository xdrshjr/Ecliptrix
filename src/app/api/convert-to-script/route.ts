import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — script conversion can be long-running when video understanding
// is enabled.
export const { POST } = createPassthroughRoute('/api/convert-to-script', {
  timeoutMs: 300_000,
})
