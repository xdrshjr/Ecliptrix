import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Multipart video upload, longer timeout for large files.
export const { POST } = createPassthroughRoute('/api/storage/upload-video', {
  timeoutMs: 120_000,
})
