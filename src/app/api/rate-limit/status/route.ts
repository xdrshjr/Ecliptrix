import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// GET the read-only live rate-limit status counters (admin-only on the backend).
export const { GET } = createPassthroughRoute('/api/rate-limit/status')
