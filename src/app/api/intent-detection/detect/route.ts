/**
 * Proxy route: POST /api/intent-detection/detect → backend /api/intent-detection/detect
 *
 * Replaces the old hand-rolled `src/app/api/intent-detection/route.ts` that
 * imported `detectIntent` in-process. The browser now calls this proxy via
 * `http.post('/api/intent-detection/detect', ...)`, and the proxy forwards
 * the request (with `Authorization`) to the FastAPI backend.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/06-direct-browser-call-migration.md §4.1
 */
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'

export const { POST } = createPassthroughRoute('/api/intent-detection/detect')
