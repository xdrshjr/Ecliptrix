import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Multipart upload — body is forwarded untouched. The 15-minute timeout
// covers a 200-frame, 200MB JPEG batch on a slow uplink.
export const { POST } = createPassthroughRoute('/api/frame-pack/create', {
  timeoutMs: 900_000,
})
