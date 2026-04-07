import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/ark-video/generate', {
  timeoutMs: 300_000,
})
