import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Allowlisted on the backend (T01). Body carries user_id + session_token.
export const { POST } = createPassthroughRoute('/api/auth/validate-session')
