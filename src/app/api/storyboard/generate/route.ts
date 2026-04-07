import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — storyboard generation calls an LLM on the backend.
export const { POST } = createPassthroughRoute('/api/storyboard/generate', {
  timeoutMs: 300_000,
})
