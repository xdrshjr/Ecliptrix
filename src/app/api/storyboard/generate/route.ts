import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Chained 2×2 generation (up to 4 batches @ 16 scenes) can take minutes —
// the BFF must outlast the backend's own per-batch retries plus Seedream's
// typical 40–90s-per-call latency. 15 min gives comfortable headroom
// (Nginx upstream is already 3600s).
export const { POST } = createPassthroughRoute('/api/storyboard/generate', {
  timeoutMs: 900_000,
})
