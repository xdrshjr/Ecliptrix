import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { DELETE } = createPassthroughRoute(
  (p) => `/api/model-settings/assignments/${p.functionType as string}`,
)
