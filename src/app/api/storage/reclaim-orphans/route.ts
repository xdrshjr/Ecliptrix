import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

// Reclaim orphaned derived thumbnail dirs / waveform files
// (local-video-editing-refactor spec 06 §2.4). The frontend supplies the
// referenced material key set (library ∪ project refs); an EMPTY set makes the
// backend SKIP reclaim (safety threshold).
export const { POST } = createPassthroughRoute('/api/storage/reclaim-orphans')
