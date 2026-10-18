import { protectedSettingsWrite } from '@/lib/server/researchUiOrigin'

export const PUT = protectedSettingsWrite(
  (p) => `/api/system-settings/${p.category as string}/${p.key as string}`,
  'PUT',
)
