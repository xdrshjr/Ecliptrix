/**
 * Event name kept from the pre-wizard setup guide so every existing listener
 * keeps working (zero migration). Dispatched after ANY successful write of
 * model / search credentials — wizard or settings page alike.
 */
export const SETUP_CONFIG_UPDATED_EVENT = 'ecliptrix-llm-config-updated';

/** Tell `useSetupStatus` (and any other listener) to re-read the status. */
export function notifySetupConfigUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SETUP_CONFIG_UPDATED_EVENT));
}
