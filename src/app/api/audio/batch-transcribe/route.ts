import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — batch transcription can take a few minutes for many clips.
export const { POST } = createPassthroughRoute('/api/audio/batch-transcribe', {
  timeoutMs: 600_000,
})
