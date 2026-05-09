import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Static (non-dynamic) routes for /api/video-projects: GET (list) + POST (create).
// Forward Accept-Language so the backend can pick a locale-aware collation
// for sort=name (iter10 Bug #5).
export const { GET, POST } = createPassthroughRoute('/api/video-projects', {
  forwardHeaders: ['accept-language'],
})
