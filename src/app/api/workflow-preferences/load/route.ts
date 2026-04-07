import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern A — body key rename (`userId → user_id`) delegated to T05 client.
export const { POST } = createPassthroughRoute('/api/workflow-preferences/load')
