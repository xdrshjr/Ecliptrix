import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET, PUT } = createPassthroughRoute(
  '/api/model-settings/assignments',
)
