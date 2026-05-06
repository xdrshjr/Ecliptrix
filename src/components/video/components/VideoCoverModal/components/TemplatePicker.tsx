'use client';

import React from 'react';

import { COVER_TEMPLATES } from '../templates';
import type { CoverTemplateDefinition, CoverTemplateId } from '../types';
import { useLocale } from '@/contexts/LocaleContext';

interface TemplatePickerProps {
  selectedId: CoverTemplateId;
  onSelect: (id: CoverTemplateId) => void;
  disabled?: boolean;
}

/**
 * 2×2 grid of template thumbnails. Selected card gets a primary-colored
 * outline; the rest stay neutral. All chrome via CSS variables — no inline
 * hex (theme-adaptive per spec §2.4).
 */
export const TemplatePicker: React.FC<TemplatePickerProps> = ({
  selectedId,
  onSelect,
  disabled,
}) => {
  const { t } = useLocale();
  const labels = t.videoCoverModal?.templates ?? {
    title: 'Title',
    tutorial: 'Tutorial',
    click: 'Click-bait',
    minimal: 'Minimal',
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {COVER_TEMPLATES.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          label={labels[template.i18nKey]}
          selected={selectedId === template.id}
          disabled={disabled}
          onClick={() => onSelect(template.id)}
        />
      ))}
    </div>
  );
};

interface TemplateCardProps {
  template: CoverTemplateDefinition;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  template,
  label,
  selected,
  disabled,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={[
        'flex flex-col items-stretch gap-1 p-1.5 rounded-md text-xs',
        'border transition-colors',
        selected
          ? 'border-primary ring-1 ring-primary text-foreground'
          : 'border-border text-muted-foreground hover:border-primary/60 hover:text-foreground',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <span
        className="block w-full aspect-video rounded-sm overflow-hidden bg-muted"
        // We trust the inline SVG strings — they are static module constants
        // defined in our own ``./templates/*`` files, not user input.
        dangerouslySetInnerHTML={{ __html: template.thumbnailSvg }}
      />
      <span className="px-1 text-center font-medium">{label}</span>
    </button>
  );
};

export default TemplatePicker;
