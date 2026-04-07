import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/model-settings/test-connection', {
  timeoutMs: 60_000,
})
