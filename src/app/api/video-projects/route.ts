import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Static (non-dynamic) routes for /api/video-projects: GET (list) + POST (create)
export const { GET, POST } = createPassthroughRoute('/api/video-projects')
