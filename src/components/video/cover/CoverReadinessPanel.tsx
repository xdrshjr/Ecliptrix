'use client';
import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverReadinessIssue, CoverReadinessResult,
  CoverTextField } from '@/types/videoCover';

export const readinessIssueId = (prefix: string, issue: CoverReadinessIssue) =>
  `${prefix}-readiness-${issue.code}-${issue.field ?? 'global'}`;

export function CoverReadinessPanel({ idPrefix, result, onEditField,
  onChooseImage, onRetry }: {
  idPrefix: string; result: CoverReadinessResult;
  onEditField: (field: CoverTextField) => void;
  onChooseImage: () => void; onRetry: () => void;
}) {
  const { t } = useLocale(); const c = t.coverStudio;
  const summary = result.status === 'checking' ? c.checkingPreview
    : result.status === 'ready' ? c.previewReady : c.previewBlocked;
  const [announcement, setAnnouncement] = useState('');
  const signature = JSON.stringify(result.issues);
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(summary), 250);
    return () => clearTimeout(timer);
  }, [summary, signature]);
  const fieldName = (field: CoverTextField) => field === 'title' ? c.titleField : c[field];
  return <section id={`${idPrefix}-readiness`} className="cover-readiness"
    data-status={result.status} aria-label={c.previewCheck}>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    <p>{summary}</p>
    {result.issues.length > 0 && <ul>{result.issues.map(issue => {
      const field = issue.field ?? 'title';
      const text = c.readinessReasons[issue.code].replace('{field}', fieldName(field));
      const isText = issue.code === 'content-empty' || issue.code === 'text-overflow';
      const retry = issue.code === 'background-unreadable' || issue.code === 'font-unavailable';
      return <li key={`${issue.code}-${field}`}>
        <span id={readinessIssueId(idPrefix, issue)}>{text}</span>
        <div>
          {isText && <button onClick={() => onEditField(field)}>
            {c.editField.replace('{field}', fieldName(field))}</button>}
          {retry && <button onClick={onRetry}>{c.retryCheck}</button>}
          {issue.code.startsWith('background-') &&
            <button onClick={onChooseImage}>{c.chooseImage}</button>}
        </div>
      </li>;
    })}</ul>}
  </section>;
}
