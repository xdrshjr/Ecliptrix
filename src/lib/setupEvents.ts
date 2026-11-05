import type { IntegrationId } from '@/lib/api/integrations';

/**
 * Event name kept from the pre-wizard setup guide so every existing listener
 * keeps working (zero migration). Dispatched after ANY successful write of
 * model / search credentials — wizard or settings page alike.
 */
export const SETUP_CONFIG_UPDATED_EVENT = 'ecliptrix-llm-config-updated';
const CONFIG_REVISION_KEY = 'ecliptrix-generation-config-revision';
let configRevision = 'initial';

/** 不包含配置值；用于使已保存配置之前的能力失败记录过期。 */
export function readSetupConfigRevision(): string {
  if (typeof window === 'undefined') return configRevision;
  try { return window.localStorage.getItem(CONFIG_REVISION_KEY) ?? configRevision; }
  catch { return configRevision; }
}

/** Tell `useSetupStatus` (and any other listener) to re-read the status. */
export function notifySetupConfigUpdated(): void {
  if (typeof window === 'undefined') return;
  configRevision = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try { window.localStorage.setItem(CONFIG_REVISION_KEY, configRevision); }
  catch { /* 禁用持久存储时，本次会话仍能使失败记录过期。 */ }
  window.dispatchEvent(new Event(SETUP_CONFIG_UPDATED_EVENT));
}

/**
 * Asks the page to open the setup wizard (manual mode) from anywhere, e.g. the
 * "go configure" button next to a "credentials missing" error. `focus` jumps
 * to that integration's card.
 */
export const OPEN_SETUP_WIZARD_EVENT = 'ecliptrix-open-setup-wizard';

export interface OpenSetupWizardDetail {
  focus?: IntegrationId;
}

export function openSetupWizard(focus?: IntegrationId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OpenSetupWizardDetail>(OPEN_SETUP_WIZARD_EVENT, { detail: { focus } }),
  );
}
