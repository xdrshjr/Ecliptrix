import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// GET + PUT the rate-limit config. The helper forwards Authorization +
// x-session-token so the backend `require_admin` on rate_limit_settings_router
// sees the caller's session (verified in TODO 05 audit).
export const { GET, PUT } = createPassthroughRoute('/api/rate-limit/config')
