/**
 * Proxy route: GET /api/llm/models → backend /api/llm/models
 *
 * Replaces the direct browser → backend call from `src/lib/api/llm.ts`
 * (`fetchLLMModels`).
 */
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { GET } = createPassthroughRoute('/api/llm/models')
