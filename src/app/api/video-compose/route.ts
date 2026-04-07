import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern C — long-running video composition (10 minute timeout). The body
// validation that previously lived here has been moved to the typed client
// at `src/lib/api/videoComposition.ts` (T05). The retry loop is dropped per
// spec §5: long-running calls should fail loud, not silently retry.
export const { POST } = createPassthroughRoute('/api/video/compose', {
  timeoutMs: 600_000,
})
