'use client';

import React from 'react';
import { StoryboardGridSize } from '@/types';

const GRID_OPTIONS: { value: StoryboardGridSize; label: string; count: number }[] = [
  { value: '2x2', label: '2x2', count: 4 },
  { value: '3x3', label: '3x3', count: 9 },
  { value: '4x4', label: '4x4', count: 16 },
  { value: '6x6', label: '6x6', count: 36 },
  { value: '8x8', label: '8x8', count: 64 },
];

interface GridSizeSelectorProps {
  value: StoryboardGridSize;
  onChange: (size: StoryboardGridSize) => void;
  disabled?: boolean;
}

const GridSizeSelector: React.FC<GridSizeSelectorProps> = ({ value, onChange, disabled }) => {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        宫格规格
      </label>
      <div className="flex gap-2">
        {GRID_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            className={`flex-1 py-2.5 px-2 rounded-md text-xs font-medium border transition-colors ${
              value === option.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground border-border hover:border-muted-foreground'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {option.label} ({option.count}格)
          </button>
        ))}
      </div>
    </div>
  );
};

export default GridSizeSelector;
