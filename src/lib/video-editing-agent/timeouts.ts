/**
 * timeouts.ts — agent run timeouts shared by the chat route and the client
 * stream manager, so both sides agree on what "no progress" means.
 *
 * The server watchdog resets on tool activity and ends an idle run with an
 * `error { code: 'server_timeout' }` event. The client waits a grace period
 * longer: if both timers expired together the client could abort the
 * connection before that error arrived, and the user would see a generic
 * timeout instead of the server's explanation.
 */

/** A run with no tool activity for this long is stopped by the server. */
export const AGENT_IDLE_TIMEOUT_MS = 1_800_000;

/** Extra time the client waits after the server's idle timeout. */
export const CLIENT_IDLE_GRACE_MS = 60_000;

/** Hard cap on one run, however active it stays. */
export const AGENT_MAX_DURATION_MS = 7_200_000;
