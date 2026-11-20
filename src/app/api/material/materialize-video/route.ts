import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';

// Explicit selection can include gateway ingest and an authenticated asset GET.
export const { POST } = createPassthroughRoute('/api/material/materialize-video', {
  timeoutMs: 180_000,
  // Keep structured JSON and Retry-After through this route's pass-through.
  streaming: true,
  responseHeaderAllowlist: ['content-type', 'retry-after'],
  abortOnClientDisconnect: true,
});
