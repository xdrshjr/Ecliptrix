'use client';
import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
export function CoverEntryButton({ onClick, thumbnailUrl }: {
  onClick: () => void; thumbnailUrl?: string;
}) {
  const { t } = useLocale();
  return <button type="button" data-cover-entry onClick={onClick}
    className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2">
    {thumbnailUrl ? <img src={thumbnailUrl} alt="" width={24} height={24}
      className="rounded object-cover" /> : <span aria-hidden="true">▧</span>}
    {thumbnailUrl ? t.coverStudio.editCover : t.coverStudio.create}
  </button>;
}
