import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, POST } = createPassthroughRoute('/api/video-projects/categories')
