'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { formatBytes } from '@/lib/agentToolkitStatus';
import { workspaceDownloadUrl } from '@/lib/api/agentToolkit';
import { formatRelativeTime } from '@/lib/relativeTime';
import type { DocumentEntry, WorkspaceEntry } from '@/types/agentToolkit';

/** The workspace file table and document list of the Agent capabilities page. */

export function WorkspaceFileTable({ files, onDelete }: {
  files: WorkspaceEntry[];
  onDelete: (name: string) => void;
}) {
  const { t, locale } = useLocale();
  const copy = t.agentToolkit;
  if (!files.length) {
    return <p className="text-sm text-muted-foreground">{copy.emptyFiles}</p>;
  }
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{copy.sectionWorkspace}</caption>
      <tbody>
        {files.map((file) => (
          <tr key={file.name} className="border-t border-border align-top">
            <td className="py-2 pr-2 break-all">{file.name}</td>
            <td className="py-2 pr-2 whitespace-nowrap">
              {formatBytes(file.bytes)}
            </td>
            <td className="py-2 pr-2 whitespace-nowrap text-muted-foreground">
              {formatRelativeTime(file.mtime, locale, t)}
            </td>
            <td className="py-2 pr-2 whitespace-nowrap">
              <a href={workspaceDownloadUrl(file.name)} download
                aria-label={`${copy.download} ${file.name}`}
                className="underline underline-offset-2">
                {copy.download}
              </a>
            </td>
            <td className="py-2 whitespace-nowrap">
              <button type="button"
                aria-label={`${copy.delete} ${file.name}`}
                onClick={() => onDelete(file.name)}
                className="text-destructive underline underline-offset-2">
                {copy.delete}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DocumentList({ documents }: { documents: DocumentEntry[] }) {
  const { t, locale } = useLocale();
  const copy = t.agentToolkit;
  if (!documents.length) {
    return (
      <p className="text-sm text-muted-foreground">{copy.emptyDocuments}</p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {documents.map((document) => (
        <li key={document.documentId}
          className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="break-all">{document.name}</span>
          <span className="text-xs text-muted-foreground">
            {document.pages}{' · '}
            {formatRelativeTime(document.createdAt, locale, t)}
          </span>
        </li>
      ))}
    </ul>
  );
}
