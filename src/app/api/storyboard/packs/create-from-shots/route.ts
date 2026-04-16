import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/storyboard/packs/create-from-shots', {
  timeoutMs: 300_000,
})
