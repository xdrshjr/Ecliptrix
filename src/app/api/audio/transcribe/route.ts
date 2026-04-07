/**
 * Proxy route: POST /api/audio/transcribe → backend /api/audio/transcribe
 *
 * Replaces the direct browser → backend call from
 * `src/lib/api/audioTranscription.ts` (`transcribeAudioFromFile`).
 *
 * The backend endpoint is synchronous and accepts multipart uploads up to
 * 100MB. A 5-minute timeout gives enough headroom for large audio files.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/06-direct-browser-call-migration.md §4.3
 */
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/audio/transcribe', {
  timeoutMs: 300_000,
})
