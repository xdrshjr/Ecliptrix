import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';

export const { GET } = createPassthroughRoute(
  p => `/api/video-cover-v2/${encodeURIComponent(String(p.projectId))}/revisions/${encodeURIComponent(String(p.revisionId))}`,
);
