import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';

export const { POST } = createPassthroughRoute(
  p => `/api/video-cover-v2/${encodeURIComponent(String(p.projectId))}/jobs/${encodeURIComponent(String(p.jobId))}/cancel`,
);
