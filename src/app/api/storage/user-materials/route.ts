import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Query string `?user_id=...&page=...&material_type=...` forwarded automatically.
export const { GET } = createPassthroughRoute('/api/storage/user-materials')
