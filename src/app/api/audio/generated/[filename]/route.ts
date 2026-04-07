import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Pattern D — audio file binary download. Stream the response so large files
// don't get buffered into memory.
export const { GET } = createPassthroughRoute(
  (p) => `/api/audio/generated/${p.filename as string}`,
  { streaming: true },
)
