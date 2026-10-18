import { protectedSettingsWrite } from '@/lib/server/researchUiOrigin'

export const POST = protectedSettingsWrite('/api/system-settings/reset-all', 'POST', true)
