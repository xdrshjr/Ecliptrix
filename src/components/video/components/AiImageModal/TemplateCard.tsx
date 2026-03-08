'use client';

import React from 'react';
import { PromptTemplate } from './promptTemplates';

interface TemplateCardProps {
  template: PromptTemplate;
  isSelected: boolean;
  onClick: () => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({ template, isSelected, onClick }) => (
  <button
    onClick={onClick}
    className={`text-left px-3 py-2.5 rounded-md border transition-colors flex-shrink-0 w-[130px] ${
      isSelected
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-card text-foreground border-border hover:border-muted-foreground'
    }`}
  >
    <p className="text-xs font-medium truncate">{template.label}</p>
    <p className={`text-[10px] mt-0.5 truncate ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
      {template.description}
    </p>
  </button>
);

export default TemplateCard;
