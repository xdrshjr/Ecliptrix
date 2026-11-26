'use client';

/**
 * BrowserToolbar — back / forward / reload, the address bar (omnibox) and the two
 * Agent affordances: "let the Agent handle this page" and the take-over / hand-back
 * switch (spec §4.5.2, §4.6.3). `role="toolbar"` with roving arrow keys.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useBrowserWorkspaceStore } from '@/contexts/BrowserWorkspaceContext';
import type { BrowserControlHolder, BrowserTabInfo } from '@/types/browserWorkspace';
import { resolveOmnibox, type SearchEngine } from './omnibox';
import {
  ArrowLeft, ArrowRight, Hand, Lock, RotateCw, ShieldAlert, Sparkles, X,
} from './browserIcons';

export interface BrowserToolbarProps {
  tab: BrowserTabInfo | null;
  holder: BrowserControlHolder;
  searchEngine: SearchEngine;
  onNavigate(input: string): void;
  onBack(): void;
  onForward(): void;
  onReload(): void;
  onStop(): void;
  onTakeOver(): void;
  onReturnControl(): void;
  onShareWithAgent(): void;
}

const isBlank = (url: string) => !url || url === 'about:blank';

function SecurityIcon({ secure }: { secure: BrowserTabInfo['secure'] | undefined }) {
  const { t } = useLocale();
  const copy = t.browserWorkspace.toolbar;
  if (secure === 'https') return <span title={copy.secure} className="bw-secure"><Lock size={12} /></span>;
  if (secure === 'cert_error') {
    return <span title={copy.certError} className="bw-insecure"><ShieldAlert size={12} /></span>;
  }
  if (secure === 'http') return <span title={copy.insecure} className="bw-insecure"><ShieldAlert size={12} /></span>;
  return null;
}

/** Roving arrow-key focus across the toolbar's buttons (not the address field). */
function useToolbarKeys(ref: React.RefObject<HTMLDivElement | null>) {
  return (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length].focus();
  };
}

export default function BrowserToolbar(props: BrowserToolbarProps) {
  const { tab, holder, searchEngine } = props;
  const { t } = useLocale();
  const copy = t.browserWorkspace;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const onKeyDown = useToolbarKeys(rootRef);
  const url = tab && !isBlank(tab.url) ? tab.url : '';

  // Ctrl+L from inside a page view: the main process has already returned keyboard focus to the
  // window; focus on the next frame so it has taken effect, and only once per request.
  const store = useBrowserWorkspaceStore();
  const addressFocusToken = useSyncExternalStore(
    store.subscribe, () => store.getSnapshot().addressFocusToken, () => 0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!store.consumeAddressFocus()) return;
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [addressFocusToken, store]);

  // The address bar mirrors the page until the user starts typing in it.
  useEffect(() => { if (!editing) setDraft(url); }, [url, editing]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = resolveOmnibox(draft, searchEngine);
    if (!target) return;
    props.onNavigate(target.url);
    setEditing(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={rootRef} className="bw-toolbar" role="toolbar" aria-label={copy.toolbar.ariaLabel}
      onKeyDown={onKeyDown}>
      <button type="button" className="bw-icon-btn" aria-label={copy.toolbar.back} title={copy.toolbar.back}
        disabled={!tab?.canGoBack} onClick={props.onBack}><ArrowLeft /></button>
      <button type="button" className="bw-icon-btn" aria-label={copy.toolbar.forward} title={copy.toolbar.forward}
        disabled={!tab?.canGoForward} onClick={props.onForward}><ArrowRight /></button>
      {tab?.loading ? (
        <button type="button" className="bw-icon-btn" aria-label={copy.toolbar.stop} title={copy.toolbar.stop}
          onClick={props.onStop}><X /></button>
      ) : (
        <button type="button" className="bw-icon-btn" aria-label={copy.toolbar.reload} title={copy.toolbar.reload}
          disabled={!tab} onClick={props.onReload}><RotateCw /></button>
      )}
      <form className="bw-address" onSubmit={submit}>
        <SecurityIcon secure={tab?.secure} />
        <input ref={inputRef} className="bw-address-input" type="text" spellCheck={false}
          autoComplete="off" aria-label={copy.toolbar.address} placeholder={copy.toolbar.addressPlaceholder}
          value={draft} disabled={!tab}
          onFocus={(event) => { setEditing(true); event.currentTarget.select(); }}
          onBlur={() => setEditing(false)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setDraft(url); event.currentTarget.blur(); event.stopPropagation(); }
          }} />
      </form>
      <button type="button" className="bw-btn bw-share" disabled={!url}
        title={copy.toolbar.shareWithAgent} aria-label={copy.toolbar.shareWithAgent}
        onClick={props.onShareWithAgent}>
        <Sparkles size={13} /><span className="bw-btn-label">{copy.toolbar.shareWithAgent}</span>
      </button>
      {holder !== 'idle' && (
        <button type="button" className="bw-btn bw-control" data-holder={holder}
          onClick={holder === 'agent' ? props.onTakeOver : props.onReturnControl}>
          <Hand size={13} />
          <span>{holder === 'agent' ? copy.control.agent : copy.control.user}</span>
        </button>
      )}
    </div>
  );
}
