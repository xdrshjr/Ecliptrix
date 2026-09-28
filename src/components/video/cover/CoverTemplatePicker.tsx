'use client';
import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverAspectRatio, CoverTemplateId } from '@/types/videoCover';
import { COVER_TEMPLATES, createCoverDocument } from './templates';
import { CoverCanvas } from './CoverCanvas';
import { coverSize, fitCoverPreview } from './layout';

export function CoverTemplatePicker({ value, onChange, aspectRatio }: {
  value: CoverTemplateId; onChange: (value: CoverTemplateId) => void;
  aspectRatio: CoverAspectRatio;
}) {
  const { t } = useLocale(); const copy = t.coverStudio;
  const ids = Object.keys(COVER_TEMPLATES) as CoverTemplateId[];
  const fit = fitCoverPreview(coverSize(aspectRatio),
    { width: 160, height: 96 }, 0);
  return <div className="cover-templates" role="radiogroup" aria-label={copy.templates}>
    {ids.map((id, index) => <button key={id} type="button" role="radio"
      aria-checked={id === value} aria-label={copy[id]}
      tabIndex={id === value ? 0 : -1}
      onClick={() => onChange(id)} onKeyDown={event => {
        const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1
          : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
        if (!direction) return;
        event.preventDefault(); const next = ids[(index + direction + ids.length) % ids.length];
        onChange(next);
        (event.currentTarget.parentElement?.children[ids.indexOf(next)] as HTMLElement)?.focus();
      }}>
      <span className="cover-template-image" aria-hidden="true">
        <span style={{ width: fit.width, height: fit.height }}>
          <span style={{ display: 'block', transform: `scale(${fit.scale})`,
            transformOrigin: 'top left' }}>
            <CoverCanvas document={createCoverDocument({ templateId: id,
              aspectRatio, title: copy[id], mode: 'html' })} />
          </span>
        </span>
      </span>
      <span>{copy[id]}</span><span className="cover-muted">{aspectRatio}</span>
      <span aria-hidden="true">{id === value ? '✓' : ''}</span>
    </button>)}
  </div>;
}
