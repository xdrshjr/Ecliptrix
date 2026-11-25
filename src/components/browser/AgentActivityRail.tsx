'use client';

/**
 * AgentActivityRail — what the Agent just did, newest at the bottom (spec §4.6.3).
 * Collapsed = one line (latest entry); expanded = ≤160px scrollable list of the
 * last 100. Typed text never appears (the main process already reduces it to a
 * character count) and URLs reach us without their query strings.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { BrowserActivityEntry, BrowserActivityKind } from '@/types/browserWorkspace';
import {
  AlertCircle, ArrowUpDown, Check, ChevronDown, ChevronUp, Clock, Compass, Eye, Hand, Image,
  Keyboard, MousePointer, Type, X,
} from './browserIcons';

const KIND_ICONS: Record<BrowserActivityKind, React.ComponentType<{ size?: number }>> = {
  open: Compass, read: Eye, click: MousePointer, fill: Type, press: Keyboard, scroll: ArrowUpDown,
  wait: Clock, save_image: Image, handoff: Hand, close: X, notice: AlertCircle,
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

function Row({ entry }: { entry: BrowserActivityEntry }) {
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

export default function AgentActivityRail({ entries }: { entries: BrowserActivityEntry[] }) {
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
          ? <ul className="bw-activity-latest"><Row entry={latest} /></ul>
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
            : entries.map((entry) => <Row key={entry.id} entry={entry} />)}
        </ul>
      )}
    </section>
  );
}
