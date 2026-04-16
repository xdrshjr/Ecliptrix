import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/tts/ai-audio-synthesize', { timeoutMs: 180_000 })
