import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
import { protectedSettingsWrite } from '@/lib/server/researchUiOrigin'

export const { GET } = createPassthroughRoute(
  (p) => `/api/system-settings/${p.category as string}`,
)
export const PUT = protectedSettingsWrite(
  p => `/api/system-settings/${p.category as string}`, 'PUT')
