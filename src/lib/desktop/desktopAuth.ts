/**
 * Desktop bootstrap-credential access for silent auto-login (spec §2.2c).
 *
 * This module is intentionally narrow: it ONLY fetches the ROOT credentials the
 * main process exposes over IPC. It does NOT orchestrate login — React's
 * `login` lives in `AuthContext`'s closure and must not be passed out to a
 * plain utility module (R5). The Provider calls this to get credentials, then
 * drives its own `login`.
 */
import { isDesktop } from '@/lib/desktop/isDesktop';
import type { BootstrapCredentials } from '@/types/desktop';

/**
 * Resolve the desktop ROOT credentials, or `null` when unavailable.
 *
 * Returns `null` (never throws) when not running in the desktop shell, when the
 * preload bridge is missing, or when the IPC invoke fails — so callers can
 * treat "no credentials" as a plain no-op rather than an error path.
 */
export async function getBootstrapCredentials(): Promise<BootstrapCredentials | null> {
  if (!isDesktop()) return null;
  const bridge = window.ecliptrixDesktop;
  if (!bridge || typeof bridge.getBootstrapCredentials !== 'function') return null;
  try {
    const creds = await bridge.getBootstrapCredentials();
    if (creds && creds.username && creds.password) {
      return { username: creds.username, password: creds.password };
    }
    return null;
  } catch {
    return null;
  }
}
