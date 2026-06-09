import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Multipart filmstrip-frame persistence (local-video-editing-refactor spec 03).
// Forwards { material_id, zoom_tier, t_ms, frame } to the FastAPI backend.
export const { POST } = createPassthroughRoute('/api/storage/thumbnail-frame')
