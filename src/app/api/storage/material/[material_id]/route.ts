import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Delete a material's source file + cascade-clean its derived thumbnails /
// waveform (local-video-editing-refactor spec 06 §2.3). The optional JSON body
// ({ source_path?, extra_keys? }) is forwarded verbatim to the FastAPI backend.
export const { DELETE } = createPassthroughRoute(
  (p) => `/api/storage/material/${p.material_id as string}`,
)
