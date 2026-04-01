'use client';

import React, { useCallback, useMemo } from 'react';

// ---- Types ----

export interface SilenceSegment {
  id: string;
  start: number; // seconds
  end: number;   // seconds
  duration: number; // seconds
}

interface SilenceSegmentListProps {
  segments: SilenceSegment[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDeselectAll: () => void;
  onInvertSelection: () => void;
  onFocus: (id: string) => void;
  onPlaySegment: (id: string) => void;
}

// ---- Helpers ----

/** Format seconds to mm:ss.ms (e.g. 01:23.456) */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const wholeSecs = Math.floor(secs);
  const ms = Math.round((secs - wholeSecs) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(wholeSecs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// ---- Component ----

const SilenceSegmentList: React.FC<SilenceSegmentListProps> = ({
  segments,
  selectedIds,
  onToggle,
  onToggleAll,
  onDeselectAll,
  onInvertSelection,
  onFocus,
  onPlaySegment,
}) => {
  // Computed stats
  const stats = useMemo(() => {
    const total = segments.length;
    const selected = segments.filter(s => selectedIds.has(s.id)).length;
    const saveable = segments
      .filter(s => selectedIds.has(s.id))
      .reduce((acc, s) => acc + s.duration, 0);
    return { total, selected, saveable };
  }, [segments, selectedIds]);

  const handleRowClick = useCallback((id: string) => {
    onFocus(id);
  }, [onFocus]);

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        未检测到静音段
      </div>
    );
  }

  return (
    <div className="flex flex-col border border-border rounded-md overflow-hidden bg-card">
      {/* Stats bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border text-xs text-muted-foreground">
        <span>
          共 <span className="font-medium text-foreground">{stats.total}</span> 个静音段，
          已选 <span className="font-medium text-foreground">{stats.selected}</span> 个，
          可节省 <span className="font-medium text-foreground">{stats.saveable.toFixed(1)}</span> 秒
        </span>
      </div>

      {/* Quick action buttons */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
        <button
          type="button"
          onClick={onToggleAll}
          className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-accent text-foreground transition-colors"
        >
          全选
        </button>
        <button
          type="button"
          onClick={onDeselectAll}
          className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-accent text-foreground transition-colors"
        >
          全不选
        </button>
        <button
          type="button"
          onClick={onInvertSelection}
          className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-accent text-foreground transition-colors"
        >
          反选
        </button>
      </div>

      {/* Segment list — fixed height 200px with scroll */}
      <div className="h-[200px] overflow-y-auto">
        {segments.map((segment, index) => {
          const isSelected = selectedIds.has(segment.id);
          return (
            <div
              key={segment.id}
              onClick={() => handleRowClick(segment.id)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-b border-border/50 transition-colors hover:bg-accent/50 ${
                isSelected ? 'bg-destructive/5' : ''
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggle(segment.id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 rounded border-border accent-destructive cursor-pointer flex-shrink-0"
              />

              {/* Index */}
              <span className="w-6 text-right text-muted-foreground flex-shrink-0">
                {index + 1}
              </span>

              {/* Time range */}
              <span className="font-mono text-foreground flex-shrink-0">
                {formatTime(segment.start)} ~ {formatTime(segment.end)}
              </span>

              {/* Duration */}
              <span className="text-muted-foreground flex-shrink-0 ml-auto mr-1">
                {segment.duration.toFixed(2)}s
              </span>

              {/* Play button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlaySegment(segment.id);
                }}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                title="试听该段前后上下文"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SilenceSegmentList;
