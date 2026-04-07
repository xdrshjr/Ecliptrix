import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern A — the body key rename (`userId → user_id`) is delegated to the
// typed client at `src/lib/api/workflowPreferences.ts` (T05).
export const { POST } = createPassthroughRoute('/api/workflow-preferences/save')
