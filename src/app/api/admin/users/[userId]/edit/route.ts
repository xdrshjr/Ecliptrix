import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Next.js `[userId]/edit` (PUT) maps to backend `/api/user/profile/${userId}`.
export const { PUT } = createPassthroughRoute(
  (p) => `/api/user/profile/${p.userId as string}`,
)
