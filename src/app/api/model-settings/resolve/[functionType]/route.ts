import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
import { withNoStore } from '@/lib/server/skillrouterBff'

// The resolved model follows the AI-relay source mode, so a stale cached
// answer would keep using the old provider after the user switches.
export const GET = withNoStore(
  createPassthroughRoute(
    (p) => `/api/model-settings/resolve/${p.functionType as string}`,
  ).GET,
)
