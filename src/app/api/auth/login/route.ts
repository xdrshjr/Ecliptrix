import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Login is in the backend allowlist (T01) — no auth required.
// The previous body re-shape (`result.user → transformedUser`) is delegated
// to the new client at `src/lib/api/auth.ts` (owned by T05); this route is
// now a dumb passthrough per master plan §5.1.
export const { POST } = createPassthroughRoute('/api/auth/login')
