import type { ToolContext } from '../types';

/**
 * Construct an absolute URL for internal API calls from the server-side agent context.
 * Uses `context.apiBaseUrl` which is derived from the incoming request's origin,
 * ensuring the URL always points to the correct host/port regardless of how the
 * server was started.
 */
export function apiUrl(context: ToolContext, path: string): string {
  return `${context.apiBaseUrl}${path}`;
}
