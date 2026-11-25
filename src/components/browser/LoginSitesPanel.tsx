'use client';

/**
 * LoginSitesPanel — which hosts hold sign-ins for the active user (spec §4.6.3).
 * Lists host + cookie count only; never cookie values (§6.1: no channel returns
 * them). Opens inside the Dock over the native view, so it is a
 * `role="dialog"` + `data-native-occluder` popover (R1-5).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useBrowserBridge } from '@/contexts/BrowserWorkspaceContext';
import { bridgeCan } from '@/lib/api/browserBridge';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import type { BrowserLoginSite } from '@/types/browserWorkspace';
import { Lock, X } from './browserIcons';
import { usePopover } from './usePopover';

const MAX_ROWS = 50;

export default function LoginSitesPanel({ cookieTtlDays, activeProfileId }: {
  cookieTtlDays: number;
  /** A change of user invalidates the list. */
  activeProfileId: string;
}) {
  const { t } = useLocale();
  const copy = t.browserWorkspace;
  const getBridge = useBrowserBridge();
  const { open, setOpen, triggerRef, panelRef } = usePopover();
  const [sites, setSites] = useState<BrowserLoginSite[] | null>(null);

  const load = useCallback(async () => {
    const bridge = getBridge();
    if (!bridgeCan(bridge, 'loginSites')) return;
    try {
      const result = await bridge!.loginSites!();
      setSites(result.ok ? result.sites.slice(0, MAX_ROWS) : []);
    } catch {
      setSites([]);
    }
  }, [getBridge]);

  useEffect(() => { if (open) void load(); }, [open, load, activeProfileId]);

  const bridge = getBridge();
  if (!bridgeCan(bridge, 'loginSites')) return null;
  const canRemove = bridgeCan(bridge, 'removeSite');
  const canClear = bridgeCan(bridge, 'profiles.clearData');
  const remove = async (host: string) => {
    await bridge!.removeSite?.(host);
    await load();
  };

  return (
    <div className="bw-popover-anchor">
      <button ref={triggerRef} type="button" className="bw-btn" aria-haspopup="dialog"
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <Lock size={13} />
        <span>{copy.dock.loginSites}</span>
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label={copy.sites.title}
          data-native-occluder="true" className="bw-popover bw-popover-wide">
          <p className="bw-menu-note">
            {fillCopy(copy.sites.cookieKept, { days: cookieTtlDays })}
          </p>
          {sites === null ? null : sites.length === 0 ? (
            <p className="bw-menu-empty">{copy.sites.empty}</p>
          ) : (
            <ul className="bw-sites-list">
              {sites.map((site) => (
                <li key={site.host} className="bw-site-row">
                  <span className="bw-dot bw-dot-secure" aria-hidden="true" />
                  <span className="bw-site-host">{site.host}</span>
                  <span className="bw-menu-sub">{fillCopy(copy.sites.cookies, { n: site.cookies })}</span>
                  {canRemove && (
                    <button type="button" className="bw-icon-btn" title={copy.sites.remove}
                      aria-label={`${copy.sites.remove}: ${site.host}`}
                      onClick={() => void remove(site.host)}>
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!canRemove && canClear && sites && sites.length > 0 && (
            <button type="button" className="bw-btn bw-btn-danger"
              onClick={() => void bridge!.profiles!.clearData!(activeProfileId).then(load)}>
              {copy.sites.clearAll}
            </button>
          )}
          <p className="bw-menu-note">{copy.sites.notice}</p>
        </div>
      )}
    </div>
  );
}
