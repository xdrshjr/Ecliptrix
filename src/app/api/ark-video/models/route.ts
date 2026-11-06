import { createPassthroughRoute } from '@/lib/api/server/backend-proxy';

export const { GET } = createPassthroughRoute('/api/ark-video/models', { timeoutMs: 5000 });
