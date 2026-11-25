'use client';

/**
 * BrowserTabStrip — WAI-ARIA tablist for the Dock (spec §4.6.3). Arrow keys move
 * between tabs, Delete closes, middle click closes. Agent tabs carry a clay dot.
 * Favicons come from the main process as inline data URLs, so the renderer never
 * makes a cross-origin image request; no favicon → the tab's initial.
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { displayUrl } from './omnibox';
import { Plus, X } from './browserIcons';
import type { BrowserTabInfo } from '@/types/browserWorkspace';

export interface BrowserTabStripProps {
  tabs: BrowserTabInfo[];
  activeTabId: string | null;
  maxTabs: number;
  onActivate(id: string): void;
  onClose(id: string): void;
  onNewTab(): void;
}

function tabLabel(tab: BrowserTabInfo, fallback: string): string {
  return tab.title.trim() || displayUrl(tab.url) || fallback;
}

function TabIcon({ tab, label }: { tab: BrowserTabInfo; label: string }) {
  if (tab.loading) return <span className="bw-spinner" aria-hidden="true" />;
  if (tab.faviconUrl?.startsWith('data:image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="bw-favicon" src={tab.faviconUrl} alt="" draggable={false} />;
  }
  return <span className="bw-favicon bw-favicon-letter" aria-hidden="true">
    {label.slice(0, 1).toUpperCase()}
  </span>;
}

export default function BrowserTabStrip({
  tabs, activeTabId, maxTabs, onActivate, onClose, onNewTab,
}: BrowserTabStripProps) {
  const { t } = useLocale();
  const copy = t.browserWorkspace;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    if (event.key === 'Delete' && index >= 0) {
      event.preventDefault();
      onClose(tabs[index].id);
      return;
    }
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || tabs.length === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onActivate(next.id);
    document.getElementById(`bw-tab-${next.id}`)?.focus();
  };

  return (
    <div className="bw-tabstrip">
      <div role="tablist" aria-label={copy.tabs.ariaLabel} className="bw-tablist" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const label = tabLabel(tab, copy.tabs.newTabTitle);
          const selected = tab.id === activeTabId;
          return (
            <div key={tab.id} className="bw-tab" role="presentation" data-selected={selected || undefined}
              data-owner={tab.owner} data-crashed={tab.crashed || undefined}
              onAuxClick={(event) => { if (event.button === 1) onClose(tab.id); }}>
              <button type="button" role="tab" id={`bw-tab-${tab.id}`} aria-selected={selected}
                tabIndex={selected ? 0 : -1} className="bw-tab-main" title={label}
                onClick={() => onActivate(tab.id)}>
                {tab.owner === 'agent' && (
                  <span className="bw-agent-dot" title={copy.tabs.agentTab} aria-label={copy.tabs.agentTab} />
                )}
                <TabIcon tab={tab} label={label} />
                <span className="bw-tab-title">{label}</span>
              </button>
              <button type="button" className="bw-icon-btn bw-tab-close" tabIndex={-1}
                aria-label={`${copy.tabs.close}: ${label}`} title={copy.tabs.close}
                onClick={() => onClose(tab.id)}>
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="bw-icon-btn" aria-label={copy.tabs.newTab}
        title={tabs.length >= maxTabs ? copy.tabs.limit : copy.tabs.newTab}
        disabled={tabs.length >= maxTabs} onClick={onNewTab}>
        <Plus size={14} />
      </button>
    </div>
  );
}
