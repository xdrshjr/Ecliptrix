import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { DELETE } = createPassthroughRoute(
  (p) => `/api/workflow/agent/delete/${p.userId as string}/${p.workflowId as string}`,
)
