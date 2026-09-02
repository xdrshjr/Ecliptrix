/**
 * Proxy route: POST /api/audio/transcribe-local → backend /api/audio/transcribe-local
 *
 * Replaces the direct browser → backend call from
 * `src/lib/api/audioTranscription.ts` (`transcribeAudioFromPath`).
 *
 * The backend endpoint is synchronous — it blocks until transcription
 * completes. A 5-minute timeout gives enough headroom for long audio files.
 */
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/audio/transcribe-local', {
  timeoutMs: 300_000,
})
