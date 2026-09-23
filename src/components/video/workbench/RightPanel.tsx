'use client';

/**
 * RightPanel — the 「素材 | 属性」 tool window (spec §3.7).
 *
 * Both pages stay mounted and the inactive one is only `hidden`, so the
 * materials page keeps its scroll position, search text and expanded packs
 * across tab switches. The active tab lives in the focus store and changes
 * only on an explicit tab click / arrow key here (or the tool-window rail):
 * selecting something elsewhere must never switch it (iron rule §3.4.1).
 */

import React, { useId, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore, type RightPanelTab } from '@/stores/editorFocusStore';

export interface RightPanelProps {
  materialsPanel: React.ReactNode;
  inspectorPanel: React.ReactNode;
  id?: string;
}

const TABS: readonly RightPanelTab[] = ['materials', 'properties'];

export default function RightPanel({ materialsPanel, inspectorPanel, id }: RightPanelProps) {
  const { t } = useLocale();
  const activeTab = useEditorFocusStore((s) => s.rightPanelTab);
  const setRightPanelTab = useEditorFocusStore((s) => s.setRightPanelTab);
  const baseId = useId();
  const tabRefs = useRef<Record<RightPanelTab, HTMLButtonElement | null>>({
    materials: null,
    properties: null,
  });

  const tabId = (tab: RightPanelTab) => `${baseId}-tab-${tab}`;
  const panelId = (tab: RightPanelTab) => `${baseId}-panel-${tab}`;
  const labels: Record<RightPanelTab, string> = {
    materials: t.workbench.side.tabMaterials,
    properties: t.workbench.side.tabProperties,
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(activeTab);
    let next: RightPanelTab | null = null;
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
    if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
    if (event.key === 'Home') next = TABS[0];
    if (event.key === 'End') next = TABS[TABS.length - 1];
    if (!next) return;
    event.preventDefault();
    setRightPanelTab(next);
    tabRefs.current[next]?.focus();
  };

  const panels: Record<RightPanelTab, React.ReactNode> = {
    materials: materialsPanel,
    properties: inspectorPanel,
  };

  return (
    <div id={id} className="ws-right-panel">
      <div
        className="ws-tabs"
        role="tablist"
        aria-label={t.workbench.regions.side}
        onKeyDown={handleKeyDown}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            ref={(node) => {
              tabRefs.current[tab] = node;
            }}
            id={tabId(tab)}
            type="button"
            role="tab"
            className="ws-tab"
            aria-selected={activeTab === tab}
            aria-controls={panelId(tab)}
            tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => setRightPanelTab(tab)}
          >
            {labels[tab]}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab}
          id={panelId(tab)}
          role="tabpanel"
          aria-labelledby={tabId(tab)}
          className="ws-right-panel-page"
          hidden={activeTab !== tab}
        >
          {panels[tab]}
        </div>
      ))}
    </div>
  );
}
