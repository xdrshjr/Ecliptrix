import 'server-only';
import type { NextRequest } from 'next/server';
import type { RouteContext } from '@/lib/api/server/backend-proxy';
import { protectedSettingsWrite, researchProxyError } from '@/lib/server/researchUiOrigin';

/** `[id]` is spliced into a backend path, so only registry-shaped ids pass. */
const INTEGRATION_ID_PATTERN = /^[a-z_]{1,32}$/;

/**
 * Write handler for `/api/integrations/[id]{suffix}`.
 *
 * The backend rejects writes that lack `Origin` (403) or a JSON content type
 * (415) — see setup-wizard-full-capability-coverage spec §3.5 — and the
 * generic proxy forwards neither by default, so every mutation goes through
 * `protectedSettingsWrite(…, always = true)` (checks, then forwards `Origin`).
 */
export function integrationWrite(
  method: 'PUT' | 'DELETE' | 'POST',
  suffix = '',
) {
  const guarded = protectedSettingsWrite(
    (params) => `/api/integrations/${params.id as string}${suffix}`,
    method,
    true,
  );
  return async (request: NextRequest, context: RouteContext) => {
    const params = await context?.params;
    if (!INTEGRATION_ID_PATTERN.test(String(params?.id ?? ''))) {
      return researchProxyError('not_found', 404);
    }
    return guarded(request, context);
  };
}
