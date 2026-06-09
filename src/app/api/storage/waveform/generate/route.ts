import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Trigger/idempotent local audio waveform generation
// (local-video-editing-refactor spec 04). Forwards { material_id, audio_url, force? }
// to the FastAPI backend, which extracts peaks via ffmpeg and persists JSON.
export const { POST } = createPassthroughRoute('/api/storage/waveform/generate')
