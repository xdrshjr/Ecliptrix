import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Query string `?category=...&limit=...&offset=...` forwarded automatically.
export const { GET } = createPassthroughRoute('/api/system-settings/audit-log')
