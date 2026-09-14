import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — long-running AI mixed editing. Cancelling in the editor closes
// the client connection; the upstream call follows so the backend stops its
// LLM and analysis work instead of finishing for nobody (AM2-04).
export const { POST } = createPassthroughRoute('/api/ai-mixed-editing', {
  timeoutMs: 600_000,
  abortOnClientDisconnect: true,
})
