import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute('/api/video/compose/health')
