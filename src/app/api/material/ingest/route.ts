import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// BFF proxy for the material caching ingest endpoint.
//
// Browser flow: when a remote video material lands in the editing panel
// (Pexels search, Agent search, URL paste), the frontend POSTs the
// (source, source_id, url) triple here so the backend can pre-download it
// to the local cached_materials directory. The follow-up `lookup` poll
// resolves a same-origin `local_url` once the row reaches `ready` — which
// removes the CDN round-trip from the playback preview hot path.
//
// The route is a dumb pipe: shaping/validation lives on the FastAPI side
// (see backend-services/basic-service/app/routers/material_router.py).
export const { POST } = createPassthroughRoute('/api/material/ingest')
