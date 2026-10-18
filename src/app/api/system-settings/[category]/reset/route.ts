import { protectedSettingsWrite } from '@/lib/server/researchUiOrigin'

export const POST = protectedSettingsWrite(
  (p) => `/api/system-settings/${p.category as string}/reset`,
  'POST',
)
