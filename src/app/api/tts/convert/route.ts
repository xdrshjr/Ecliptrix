import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/tts/convert', {
  timeoutMs: 120_000,
})
