'use client';
import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverRevision, CoverRevisionEntry } from '@/types/videoCover';
import { parseCoverCreatedAt } from './coverResourceUtils';

interface HistoryProps {
  entries: CoverRevisionEntry[]; appliedRevisionId?: string;
  busy?: boolean; onPreview: (revision: CoverRevision) => void;
  onRestore: (id: string) => void; onDownload: (id: string) => void;
  onRetry: (id: string) => void; onPngUnavailable: (id: string) => void;
}

function RevisionCard({ entry, ...props }: Omit<HistoryProps, 'entries'> & {
  entry: CoverRevisionEntry;
}) {
  const { t, locale } = useLocale(); const c = t.coverStudio;
  const revision = entry.revision;
  const readable = entry.pngStatus !== 'unavailable';
  const canRestore = entry.metadataStatus !== 'unavailable' &&
    entry.backgroundStatus !== 'unavailable' &&
    entry.metadataStatus !== 'checking' && entry.backgroundStatus !== 'checking';
  const needsRetry = [entry.metadataStatus, entry.pngStatus,
    entry.backgroundStatus].some(status => status !== 'readable');
  const timestamp = parseCoverCreatedAt(revision?.createdAt);
  return <li className="cover-revision-card" data-cover-revision-id={entry.id}>
    {props.appliedRevisionId === entry.id &&
      <strong className="cover-revision-applied">{c.usedInVideo}</strong>}
    {!revision ? <><p>{c.referencedUnavailable}</p><small>{entry.id}</small></>
      : <>
        <button className="cover-revision-preview" data-cover-action="preview"
          aria-label={`${c.preview} · ${c[revision.document.templateId]}`}
          disabled={!readable} onClick={() => props.onPreview(revision)}>
          {readable ? <img src={revision.url} alt="" loading="lazy"
            onError={() => props.onPngUnavailable(entry.id)} />
            : <span>{c.pngUnavailable}</span>}
        </button>
        <strong>{c[revision.document.templateId]}</strong>
        <small>{c[revision.document.mode]} · {revision.document.aspectRatio}</small>
        <time dateTime={timestamp === null ? undefined
          : new Date(timestamp).toISOString()}>{timestamp === null
          ? c.unknownDate : new Date(timestamp).toLocaleString(locale)}</time>
        {entry.backgroundStatus === 'unavailable' &&
          <p className="cover-muted">{c.backgroundMissing}</p>}
        <div className="cover-revision-actions">
          <button data-cover-action="restore" disabled={props.busy || !canRestore}
            onClick={() => props.onRestore(entry.id)}>{c.restoreDraft}</button>
          <button data-cover-action="download" disabled={!readable ||
            entry.metadataStatus === 'unavailable'}
          onClick={() => props.onDownload(entry.id)}>{c.download}</button>
        </div>
      </>}
    {needsRetry && <button data-cover-action="retry"
      disabled={entry.metadataStatus === 'checking'}
      onClick={() => props.onRetry(entry.id)}>{c.retryRevision}</button>}
  </li>;
}

export function CoverRevisionHistory({ entries, ...props }: HistoryProps) {
  const { t } = useLocale();
  if (!entries.length) return <p className="cover-muted cover-resource-empty">
    {t.coverStudio.emptyRevisions}</p>;
  return <ul className="cover-revision-strip" aria-label={t.coverStudio.recentRevisions}>
    {entries.map(entry => <RevisionCard key={entry.id} entry={entry} {...props} />)}
  </ul>;
}
