import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Next.js URL `/api/admin/users/[userId]/toggle-status` does NOT mirror
// the backend URL — backend is `/api/user/toggle-status/${userId}`.
export const { POST } = createPassthroughRoute(
  (p) => `/api/user/toggle-status/${p.userId as string}`,
)
