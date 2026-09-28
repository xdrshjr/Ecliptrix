'use client';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverAsset, CoverJob, CoverJobConnection, CoverResourceTab,
  CoverRevision, CoverRevisionEntry } from '@/types/videoCover';
import { selectCoverAssets, selectCoverRevisions } from './coverResourceUtils';
import { CoverCandidates } from './CoverCandidates';
import { CoverRevisionHistory } from './CoverRevisionHistory';

interface ResourceProps {
  assets: CoverAsset[]; jobs: CoverJob[]; revisionEntries: CoverRevisionEntry[];
  selectedAssetId: string | null; appliedRevisionId?: string;
  tab: CoverResourceTab; onTabChange: (tab: CoverResourceTab) => void;
  busy?: boolean; connection?: CoverJobConnection;
  compact?: boolean;
  onSelect: (asset: CoverAsset) => void; onCancel: (id: string) => void;
  onRefresh: () => void; onRegenerate?: () => void;
  onPreview: (revision: CoverRevision) => void; onRestore: (id: string) => void;
  onDownload: (id: string) => void; onRetry: (id: string) => void;
  onPngUnavailable: (id: string) => void;
}

export function CoverResources(props: ResourceProps) {
  const { t } = useLocale(); const c = t.coverStudio; const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const focusedPanel = useRef(false);
  const tabs = useRef(new Map<CoverResourceTab, HTMLButtonElement>());
  const currentTab = useRef(props.tab); currentTab.current = props.tab;
  useEffect(() => {
    if (!props.compact || !expanded || !dialog.current) return;
    const node = dialog.current;
    const tabNodes = tabs.current;
    node.showModal(); closeButton.current?.focus();
    return () => {
      node.close(); tabNodes.get(currentTab.current)?.focus();
    };
  }, [props.compact, expanded]);
  useEffect(() => {
    setExpanded(false);
    if (focusedPanel.current) {
      tabs.current.get(currentTab.current)?.focus(); focusedPanel.current = false;
    }
  }, [props.compact]);
  const closeResources = () => {
    dialog.current?.close(); setExpanded(false);
  };
  const chooseTab = (tab: CoverResourceTab) => {
    props.onTabChange(tab);
    if (props.compact) setExpanded(true);
  };
  const assets = useMemo(() => selectCoverAssets(props.assets, props.jobs,
    props.selectedAssetId), [props.assets, props.jobs, props.selectedAssetId]);
  const entries = useMemo(() => {
    const revisions = props.revisionEntries.flatMap(entry =>
      entry.revision ? [entry.revision] : []);
    const visible = selectCoverRevisions(revisions, props.appliedRevisionId)
      .flatMap(revision => props.revisionEntries.filter(entry => entry.id === revision.id));
    const missing = props.revisionEntries.find(entry =>
      entry.id === props.appliedRevisionId && !entry.revision);
    return missing ? [missing, ...visible] : visible;
  }, [props.revisionEntries, props.appliedRevisionId]);
  const panel = <div id={`${id}-panel`} role="tabpanel"
    aria-labelledby={`${id}-${props.tab}`}
    hidden={!props.compact && collapsed} className="cover-resource-panel">
    {props.tab === 'images' ? <CoverCandidates assets={assets} jobs={props.jobs}
      value={props.selectedAssetId} onSelect={props.onSelect}
      onCancel={props.onCancel} connection={props.connection}
      onRefresh={props.onRefresh} onRegenerate={props.onRegenerate} />
      : <CoverRevisionHistory entries={entries}
        appliedRevisionId={props.appliedRevisionId} busy={props.busy}
        onPreview={revision => { closeResources(); props.onPreview(revision); }}
        onRestore={revisionId => { closeResources(); props.onRestore(revisionId); }}
        onDownload={props.onDownload} onRetry={props.onRetry}
        onPngUnavailable={props.onPngUnavailable} />}
  </div>;
  const isExpanded = props.compact ? expanded : !collapsed;
  return <section className="cover-resources" data-compact={props.compact}
    data-collapsed={!isExpanded} onFocusCapture={event => {
      focusedPanel.current = !!(event.target as HTMLElement)
        .closest('.cover-resource-panel');
    }} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        focusedPanel.current = false;
      }
    }}>
    <header><div role="tablist" aria-label={c.images}>
      {(['images', 'revisions'] as const).map(tab => <button key={tab}
        data-cover-resource-tab={tab}
        ref={node => { if (node) tabs.current.set(tab, node); }}
        role="tab" id={`${id}-${tab}`} aria-controls={`${id}-panel`}
        aria-selected={props.tab === tab} tabIndex={props.tab === tab ? 0 : -1}
        onClick={() => chooseTab(tab)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault(); const next = tab === 'images' ? 'revisions' : 'images';
          chooseTab(next); tabs.current.get(next)?.focus();
        }}>{tab === 'images' ? `${c.images} · ${assets.length}` : c.recentRevisions}</button>)}
    </div><button aria-expanded={isExpanded} aria-controls={`${id}-panel`}
      onClick={() => props.compact ? setExpanded(value => !value)
        : setCollapsed(value => !value)}>
      {isExpanded ? c.collapseResources : c.expandResources}</button></header>
    {props.compact ? <dialog ref={dialog} className="cover-resources-dialog"
      aria-labelledby={`${id}-title`} onCancel={event => {
        event.preventDefault(); event.stopPropagation(); closeResources();
      }} onClose={() => setExpanded(false)} onKeyDown={event => {
        if (event.key === 'Escape') event.stopPropagation();
      }}>
      <header><h3 id={`${id}-title`}>
        {props.tab === 'images' ? c.images : c.recentRevisions}</h3>
        <button ref={closeButton} onClick={closeResources}>{c.close}</button>
      </header>{panel}
    </dialog> : panel}
  </section>;
}
