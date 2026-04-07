'use client';

import React, { useState, useEffect } from 'react';

const PRESET_OPTIONS: { label: string; frameCount: number }[] = [
  { label: '2x2', frameCount: 4 },
  { label: '3x3', frameCount: 9 },
  { label: '4x4', frameCount: 16 },
  { label: '6x6', frameCount: 36 },
  { label: '8x8', frameCount: 64 },
];

/** Compute optimal grid layout (mirrors backend logic). For UI preview only. */
function computeOptimalGrid(frameCount: number): { rows: number; cols: number } {
  if (frameCount <= 0 || frameCount === 1) return { rows: 1, cols: 1 };

  let cols = Math.ceil(Math.sqrt(frameCount));
  while (true) {
    const rows = Math.ceil(frameCount / cols);
    if (rows <= cols) return { rows, cols };
    cols++;
  }
}

interface GridSizeSelectorProps {
  value: number;
  onChange: (frameCount: number) => void;
  disabled?: boolean;
}

const GridSizeSelector: React.FC<GridSizeSelectorProps> = ({ value, onChange, disabled }) => {
  const isPreset = PRESET_OPTIONS.some((o) => o.frameCount === value);
  const [customMode, setCustomMode] = useState(!isPreset);
  const [customInput, setCustomInput] = useState(String(value));

  // Sync customInput when value changes externally
  useEffect(() => {
    if (!PRESET_OPTIONS.some((o) => o.frameCount === value)) {
      setCustomInput(String(value));
      setCustomMode(true);
    }
  }, [value]);

  const { rows, cols } = computeOptimalGrid(value);
  const totalCells = rows * cols;

  const handleCustomChange = (raw: string) => {
    setCustomInput(raw);
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num >= 1 && num <= 64) {
      onChange(num);
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        分镜数量
      </label>
      <div className="flex gap-2 flex-wrap">
        {PRESET_OPTIONS.map((option) => (
          <button
            key={option.frameCount}
            onClick={() => {
              setCustomMode(false);
              onChange(option.frameCount);
            }}
            disabled={disabled}
            className={`py-2.5 px-3 rounded-md text-xs font-medium border transition-colors ${
              !customMode && value === option.frameCount
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-foreground border-border hover:border-muted-foreground'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {option.label} ({option.frameCount}格)
          </button>
        ))}
        <button
          onClick={() => {
            setCustomMode(true);
            setCustomInput(String(value));
          }}
          disabled={disabled}
          className={`py-2.5 px-3 rounded-md text-xs font-medium border transition-colors ${
            customMode
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card text-foreground border-border hover:border-muted-foreground'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          自定义
        </button>
      </div>

      {customMode && (
        <div className="mt-3">
          <input
            type="number"
            min={1}
            max={64}
            value={customInput}
            onChange={(e) => handleCustomChange(e.target.value)}
            disabled={disabled}
            className="w-full border border-border rounded-md px-3 py-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="输入分镜数量 (1-64)"
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-2">
        {totalCells === value
          ? `将生成 ${rows}×${cols} = ${totalCells} 格分镜`
          : `将生成 ${rows}×${cols} = ${totalCells} 格，使用前 ${value} 帧`}
      </p>
    </div>
  );
};

export default GridSizeSelector;
