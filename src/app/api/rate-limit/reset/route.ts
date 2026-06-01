import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// POST resets the rate-limit config to defaults (admin-only on the backend).
export const { POST } = createPassthroughRoute('/api/rate-limit/reset')
