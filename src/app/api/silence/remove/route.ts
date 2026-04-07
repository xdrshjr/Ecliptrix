import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Backend returns immediately with a task_id; polling lives at
// `/api/silence/status/[taskId]`.
export const { POST } = createPassthroughRoute('/api/silence/remove')
