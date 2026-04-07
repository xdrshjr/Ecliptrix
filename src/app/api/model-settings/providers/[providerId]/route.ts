import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { PUT, DELETE } = createPassthroughRoute(
  (p) => `/api/model-settings/providers/${p.providerId as string}`,
)
