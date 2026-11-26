'use client';

/**
 * AgentActivityRail — what the Agent just did, newest at the bottom (spec §4.6.3).
 * Collapsed = one line (latest entry); expanded = ≤160px scrollable list of the
 * last 100. Typed text never appears (the main process already reduces it to a
 * character count) and URLs reach us without their query strings.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import type { BrowserActivityEntry, BrowserActivityKind } from '@/types/browserWorkspace';
import {
  AlertCircle, ArrowUpDown, Check, ChevronDown, ChevronUp, Clock, Compass, Eye, Hand, Image,
  Keyboard, MousePointer, Sparkles, Type, X,
} from './browserIcons';

const KIND_ICONS: Record<BrowserActivityKind, React.ComponentType<{ size?: number }>> = {
  open: Compass, read: Eye, click: MousePointer, fill: Type, press: Keyboard, scroll: ArrowUpDown,
  wait: Clock, save_image: Image, handoff: Hand, close: X, notice: AlertCircle,
  article: Sparkles,
};

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function StatusMark({ status }: { status: BrowserActivityEntry['status'] }) {
  if (status === 'running') return <span className="bw-spinner" role="img" aria-label="running" />;
  if (status === 'error') return <span className="bw-status-err"><AlertCircle size={12} /></span>;
  return <span className="bw-status-ok"><Check size={12} /></span>;
}

type Copy = ReturnType<typeof useLocale>['t']['browserWorkspace']['activity'];

/** ISO → local `YYYY-MM-DD HH:mm`; an unparseable value is shown verbatim (never crash). */
export function formatPublished(value: string): string {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return value;
  const date = new Date(stamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Article rows (agent-browser-article-reading §4.8): title, site and publication time.
 * A missing time is STATED, never hidden — the user has a right to know the source did
 * not declare one, and the Agent is told the same thing (L1 rule 5).
 */
function ArticleRow({ entry, copy, onOpen }: { entry: BrowserActivityEntry; copy: Copy;
  onOpen?: (tabId: string) => void }) {
  const meta = entry.articleMeta;
  const tabId = entry.tabId;
  const detail = meta ? `${meta.site ? `${meta.site} · ` : ''}${
    meta.publishedAt ? fillCopy(copy.published, { time: formatPublished(meta.publishedAt) })
      : copy.publishedMissing} · ${
    fillCopy(copy.articleBlocks, { n: meta.totalBlocks, chars: meta.chars })}` : '';
  return (
    <li className="bw-activity-row" data-status={entry.status} data-kind="article">
      <span className="bw-activity-icon"><Sparkles size={13} /></span>
      <span className="bw-activity-label">
        <span className="bw-activity-article-title">{entry.label}</span>
        <span className="bw-activity-article-meta">{detail}</span>
      </span>
      {tabId && onOpen ? (
        <button type="button" className="bw-icon-btn" title={copy.openTab}
          aria-label={copy.openTab} onClick={() => onOpen(tabId)}>
          <Eye size={12} />
        </button>
      ) : null}
      <StatusMark status={entry.status} />
      <span className="bw-activity-time">{formatDuration(entry.durationMs)}</span>
    </li>
  );
}

function Row({ entry, copy, onOpen }: { entry: BrowserActivityEntry; copy: Copy;
  onOpen?: (tabId: string) => void }) {
  if (entry.kind === 'article') return <ArticleRow entry={entry} copy={copy} onOpen={onOpen} />;
  const Icon = KIND_ICONS[entry.kind] ?? Compass;
  return (
    <li className="bw-activity-row" data-status={entry.status}>
      <span className="bw-activity-icon"><Icon size={13} /></span>
      <span className="bw-activity-label">{entry.label}</span>
      <StatusMark status={entry.status} />
      <span className="bw-activity-time">{formatDuration(entry.durationMs)}</span>
    </li>
  );
}

export default function AgentActivityRail({ entries, onOpenTab }: {
  entries: BrowserActivityEntry[]; onOpenTab?: (tabId: string) => void;
}) {
  const { t } = useLocale();
  const copy = t.browserWorkspace.activity;
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const latest = entries[entries.length - 1];

  useEffect(() => {
    if (expanded && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [expanded, entries.length]);

  return (
    <section className="bw-activity" aria-label={copy.title} data-expanded={expanded || undefined}>
      <div className="bw-activity-head">
        <span className="bw-activity-title">{copy.title}</span>
        {!expanded && (latest
          ? <ul className="bw-activity-latest">
            <Row entry={latest} copy={copy} onOpen={onOpenTab} />
          </ul>
          : <span className="bw-activity-empty">{copy.empty}</span>)}
        <button type="button" className="bw-icon-btn" aria-expanded={expanded}
          aria-label={expanded ? copy.collapse : copy.expand} title={expanded ? copy.collapse : copy.expand}
          onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>
      {expanded && (
        <ul ref={listRef} className="bw-activity-list" aria-live="off">
          {entries.length === 0
            ? <li className="bw-activity-empty">{copy.empty}</li>
            : entries.map((entry) => (
              <Row key={entry.id} entry={entry} copy={copy} onOpen={onOpenTab} />))}
        </ul>
      )}
    </section>
  );
}
