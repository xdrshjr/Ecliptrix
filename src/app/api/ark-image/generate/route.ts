import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/ark-image/generate', {
  timeoutMs: 300_000,
})
