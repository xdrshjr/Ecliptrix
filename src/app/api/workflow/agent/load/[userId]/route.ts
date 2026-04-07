import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute(
  (p) => `/api/workflow/agent/load/${p.userId as string}`,
)
