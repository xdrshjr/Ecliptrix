import { withContext, ok } from '@/server/http/route'
import * as settingsService from '@/server/services/settingsService'

/**
 * Public metadata the sign-in and sign-up screens need before the user types
 * anything: is registration open, is an invite required, is mail configured, and
 * what does the password policy demand. No secrets, no counts.
 */
export const dynamic = 'force-dynamic'

export const GET = withContext(async () => ok(settingsService.publicMeta()))
