'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Conversation } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import type { ConversationActionResult } from '../../hooks/videoChatSessionModel';
import styles from './ConversationTabs.module.css';

export interface ConversationTabsProps {
  conversations: readonly Conversation[];
  activeConversationId: string | null;
  idPrefix: string;
  busyReason?: string | null;
  onSelect: (id: string) => ConversationActionResult;
  onCreate: () => ConversationActionResult;
  onRename: (id: string, title: string) => ConversationActionResult;
  onDelete: (id: string) => void;
}

function focusTab(prefix: string, id: string) {
  const tab = document.getElementById(`${prefix}-tab-${id}`);
  tab?.focus({ preventScroll: true });
  tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** 保留 tab 节点；重命名输入是同级覆盖层，面板的标签关联始终有效。 */
function RenameInput({ id, title, onFinish, onRename }: {
  id: string; title: string;
  onFinish: () => void;
  onRename: ConversationTabsProps['onRename'];
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(title);
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const composing = useRef(false);
  const blurredWhileComposing = useRef(false);
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const commit = () => {
    if (done.current || composing.current) return;
    const next = value.trim();
    if (!next || Array.from(next).length > 40) {
      setError(true);
      input.current?.focus();
      return;
    }
    const result = onRename(id, next);
    if (!result.ok) { setError(true); return; }
    done.current = true;
    onFinish();
  };
  return <div className={styles.rename}>
    <input ref={input} value={value} aria-label={t.agentConversations.rename}
      aria-invalid={error || undefined}
      onChange={event => { setValue(event.target.value); setError(false); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => {
        composing.current = false;
        if (blurredWhileComposing.current) commit();
      }}
      onBlur={() => {
        if (composing.current) blurredWhileComposing.current = true;
        else commit();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || composing.current) return;
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
        if (event.key === 'Escape') {
          event.preventDefault(); done.current = true; onFinish();
        }
      }} />
    {error && <span className={styles.error} role="alert">
      {t.agentConversations.invalidTitle}
    </span>}
  </div>;
}

const NAVIGATION_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End',
  'Enter', ' ', 'F2'];

/** 手动激活的页签导航；焦点移动不会改变当前会话。 */
export default function ConversationTabs(props: ConversationTabsProps) {
  const { t } = useLocale();
  const copy = t.agentConversations;
  const [editing, setEditing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const busy = !!props.busyReason;
  const activeId = props.activeConversationId;
  const errorId = `${props.idPrefix}-busy`;

  useEffect(() => {
    document.getElementById(`${props.idPrefix}-tab-${activeId}`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    setMenuOpen(false);
    setActionError(false);
  }, [activeId, props.idPrefix]);
  useEffect(() => { if (busy) setMenuOpen(false); }, [busy]);
  useEffect(() => {
    if (!menuOpen) return;
    menuRoot.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node &&
          !menuRoot.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);

  const finishRename = () => {
    const id = editing;
    setEditing(null);
    if (id) focusTab(props.idPrefix, id);
  };
  const activate = (id: string) => {
    if (busy) return;
    setActionError(!props.onSelect(id).ok);
  };
  const keyDown = (event: React.KeyboardEvent, index: number) => {
    if (!NAVIGATION_KEYS.includes(event.key) || event.nativeEvent.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    const count = props.conversations.length;
    const id = props.conversations[index].id;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
      : event.key === 'ArrowLeft' ? (index + count - 1) % count
        : event.key === 'ArrowRight' ? (index + 1) % count : -1;
    if (target >= 0) focusTab(props.idPrefix, props.conversations[target].id);
    if (event.key === 'Enter' || event.key === ' ') activate(id);
    if (event.key === 'F2' && id === activeId && !busy) setEditing(id);
  };

  return <div className={styles.root} data-conversation-tabs="">
    <div role="tablist" aria-label={copy.label} className={styles.tabs}>
      {props.conversations.map((conversation, index) => (
        <div className={styles.item} key={conversation.id}>
          <button type="button" role="tab" className={styles.tab}
            id={`${props.idPrefix}-tab-${conversation.id}`}
            aria-controls={`${props.idPrefix}-panel-${conversation.id}`}
            aria-selected={conversation.id === activeId}
            aria-disabled={busy || undefined}
            aria-describedby={busy ? errorId : undefined}
            tabIndex={conversation.id === activeId && !editing ? 0 : -1}
            title={conversation.title}
            onClick={() => activate(conversation.id)}
            onKeyDown={event => keyDown(event, index)}>
            <span>{conversation.title}</span>
          </button>
          {editing === conversation.id && <RenameInput
            id={conversation.id} title={conversation.title}
            onRename={props.onRename} onFinish={finishRename} />}
        </div>
      ))}
    </div>
    <button type="button" className={styles.tool} title={copy.newConversation}
      aria-label={copy.newConversation} disabled={busy}
      onClick={() => setActionError(!props.onCreate().ok)}>
      <span aria-hidden="true">＋</span>
    </button>
    <div ref={menuRoot} className={styles.menuRoot}>
      <button ref={menuButton} type="button" className={styles.tool}
        title={copy.actions} aria-label={copy.actions} aria-haspopup="menu"
        aria-expanded={menuOpen} disabled={busy || !activeId}
        onClick={() => setMenuOpen(open => !open)}>
        <span aria-hidden="true">⋯</span>
      </button>
      {menuOpen && <div className={styles.menu} role="menu"
        aria-label={copy.actions}
        onBlur={event => {
          if (event.relatedTarget !== menuButton.current &&
              !event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
        }}
        onKeyDown={event => {
          if (event.key === 'Tab' && event.shiftKey) {
            event.preventDefault(); event.stopPropagation();
            setMenuOpen(false); menuButton.current?.focus();
          }
          if (['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ']
            .includes(event.key)) { event.stopPropagation(); }
          if (event.key === 'Escape') {
            event.preventDefault(); setMenuOpen(false); menuButton.current?.focus();
          }
          const items = Array.from(event.currentTarget
            .querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }
        }}>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => {
          setMenuOpen(false); setEditing(activeId);
        }}>{copy.rename}</button>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => {
          setMenuOpen(false);
          if (activeId) props.onDelete(activeId);
        }}>{copy.delete}</button>
      </div>}
    </div>
    <span id={errorId} role="status" className="sr-only">
      {props.busyReason ?? ''}
    </span>
    {actionError && <span role="alert" className={styles.actionError}>
      {copy.updateFailed}
    </span>}
  </div>;
}
