import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Multipart upload — the helper detects multipart and forwards via FormData
// (fetch sets the new boundary header).
export const { POST } = createPassthroughRoute('/api/storage/upload-file', {
  timeoutMs: 60_000,
})
