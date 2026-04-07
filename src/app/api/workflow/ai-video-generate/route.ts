import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — AI video generation is long-running (10 minute timeout).
export const { POST } = createPassthroughRoute(
  '/api/workflow/ai-video-generate',
  { timeoutMs: 600_000 },
)
