import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Admin-only on the backend. Authorization is forwarded automatically.
export const { GET } = createPassthroughRoute('/api/user/list')
