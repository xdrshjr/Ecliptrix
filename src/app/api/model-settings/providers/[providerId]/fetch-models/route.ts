import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute(
  (p) => `/api/model-settings/providers/${p.providerId as string}/fetch-models`,
)
