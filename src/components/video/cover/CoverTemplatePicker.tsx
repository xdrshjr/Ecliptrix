'use client';
import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverTemplateId } from '@/types/videoCover';
import { COVER_TEMPLATES, createCoverDocument } from './templates';
import { CoverCanvas } from './CoverCanvas';

export function CoverTemplatePicker({ value, onChange }: {
  value: CoverTemplateId; onChange: (value: CoverTemplateId) => void;
}) {
  const { t } = useLocale(); const copy = t.coverStudio;
  const ids = Object.keys(COVER_TEMPLATES) as CoverTemplateId[];
  return <div className="cover-templates" role="radiogroup" aria-label={copy.templates}>
    {ids.map((id, index) => <button key={id} type="button" role="radio"
      aria-checked={id === value} tabIndex={id === value ? 0 : -1}
      onClick={() => onChange(id)} onKeyDown={event => {
        const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1
          : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
        if (!direction) return;
        event.preventDefault(); const next = ids[(index + direction + ids.length) % ids.length];
        onChange(next);
        (event.currentTarget.parentElement?.children[ids.indexOf(next)] as HTMLElement)?.focus();
      }}>
      <span className="cover-template-image" aria-hidden="true">
        <span><CoverCanvas document={createCoverDocument({ templateId: id,
          title: copy[id], mode: 'html' })} /></span>
      </span>
      <span>{copy[id]}</span><span aria-hidden="true">{id === value ? '✓' : ''}</span>
    </button>)}
  </div>;
}
