import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/tts/convert-sentences', {
  timeoutMs: 300_000,
})
