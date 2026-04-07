import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Note: Next.js path is `/api/tts/batch-convert` but the backend endpoint is
// `/api/tts/convert-batch` (the previous hand-rolled file already had this
// rename — preserved here so the contract stays identical).
export const { POST } = createPassthroughRoute('/api/tts/convert-batch', {
  timeoutMs: 600_000,
})
