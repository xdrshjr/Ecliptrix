import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Read-only list of integration statuses (never carries secrets).
export const { GET } = createPassthroughRoute('/api/integrations')
