import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// BFF proxy for the material caching lookup endpoint.
//
// Polled from the browser to learn when a previously-ingested material
// flips to `ready` and to receive its same-origin `local_url`. Accepts
// either `?url=` (legacy single-arg) or the more durable
// `?source=&source_id=` composite key — see backend router for priority.
//
// Forwarded as a buffered JSON pass-through (no streaming) — the response
// payload is small and consumers want the full body before transitioning
// state.
export const { GET } = createPassthroughRoute('/api/material/lookup')
