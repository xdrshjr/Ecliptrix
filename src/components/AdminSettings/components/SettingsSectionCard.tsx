'use client';

import React from 'react';

interface SettingsSectionCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

const SettingsSectionCard: React.FC<SettingsSectionCardProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="px-6 py-4 space-y-4">
        {children}
      </div>
    </div>
  );
};

export default SettingsSectionCard;
