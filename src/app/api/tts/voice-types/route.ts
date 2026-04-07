import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Query string `?locale=...` is forwarded automatically by the helper.
export const { GET } = createPassthroughRoute('/api/tts/voice-types')
