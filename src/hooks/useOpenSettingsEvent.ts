import { useEffect, useRef } from 'react';
import type { SettingsMenuItem } from '@/components/settings/SettingsSidebar';
import { OPEN_SETTINGS_EVENT, type OpenSettingsDetail } from '@/lib/setupEvents';

/**
 * Lets any component open the settings centre through `openSettings(item)` without
 * prop drilling. The latest `onOpen` is read through a ref so the listener is bound once.
 */
export function useOpenSettingsEvent(onOpen: (item: SettingsMenuItem) => void): void {
  const latest = useRef(onOpen);
  latest.current = onOpen;
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenSettingsDetail>).detail;
      latest.current(detail?.item ?? 'general');
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
  }, []);
}
