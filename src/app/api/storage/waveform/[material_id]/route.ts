import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Fetch persisted waveform peaks (or generation status) for a material
// (local-video-editing-refactor spec 04). Consumed by the waveform cache.
export const { GET } = createPassthroughRoute(
  (p) => `/api/storage/waveform/${p.material_id as string}`,
)
