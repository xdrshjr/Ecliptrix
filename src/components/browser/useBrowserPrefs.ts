'use client';

/**
 * useBrowserPrefs — the two `browser_workspace` settings the Dock itself needs
 * (address-bar search engine, session-cookie TTL shown in the privacy copy).
 *
 * They are user PREFERENCES read from system settings (spec §4.7); a failed read
 * falls back to the defaults instead of blocking the Dock, and the settings panel
 * re-triggers a read through the shared "config updated" event.
 */

import { useEffect, useState } from 'react';
import { getCategorySettings } from '@/lib/api/systemSettings';
import { SETUP_CONFIG_UPDATED_EVENT } from '@/lib/setupEvents';
import type { SearchEngine } from './omnibox';

export interface BrowserPrefs {
  searchEngine: SearchEngine;
  sessionCookieTtlDays: number;
}

export const DEFAULT_BROWSER_PREFS: BrowserPrefs = { searchEngine: 'bing', sessionCookieTtlDays: 30 };
const ENGINES: readonly SearchEngine[] = ['bing', 'google', 'baidu', 'duckduckgo'];

/** Pure: settings items → prefs, clamping anything unexpected to the defaults. */
export function prefsFromItems(items: ReadonlyArray<{ key: string; value: unknown }>): BrowserPrefs {
  const find = (key: string) => items.find((item) => item.key === key)?.value;
  const engine = find('search_engine');
  const ttl = find('session_cookie_ttl_days');
  return {
    searchEngine: ENGINES.includes(engine as SearchEngine)
      ? (engine as SearchEngine) : DEFAULT_BROWSER_PREFS.searchEngine,
    sessionCookieTtlDays: typeof ttl === 'number' && ttl >= 0 && ttl <= 90
      ? Math.round(ttl) : DEFAULT_BROWSER_PREFS.sessionCookieTtlDays,
  };
}

export function useBrowserPrefs(enabled: boolean): BrowserPrefs {
  const [prefs, setPrefs] = useState<BrowserPrefs>(DEFAULT_BROWSER_PREFS);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () => {
      getCategorySettings('browser_workspace').then((result) => {
        if (!cancelled && Array.isArray(result.settings)) setPrefs(prefsFromItems(result.settings));
      }).catch(() => { /* keep defaults */ });
    };
    load();
    window.addEventListener(SETUP_CONFIG_UPDATED_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(SETUP_CONFIG_UPDATED_EVENT, load); };
  }, [enabled]);
  return prefs;
}
