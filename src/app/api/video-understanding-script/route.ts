import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — script generation can be long-running.
// The previous referenceText enrichment (chat messages + custom prompt) is
// delegated to the typed client at `src/lib/api/workflow.ts` (T05).
export const { POST } = createPassthroughRoute(
  '/api/video-understanding-script',
  { timeoutMs: 300_000 },
)
