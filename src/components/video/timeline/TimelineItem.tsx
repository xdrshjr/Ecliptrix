'use client';

import React, { useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore } from './store';
import type { TimelineItemData } from './domain/types';
import SentenceSegmentBar from './SentenceSegmentBar';
import { formatTimelineTime } from './timeFormat';

// ---------------------------------------------------------------------------
// Props — only data that cannot come from the store
// ---------------------------------------------------------------------------

interface TimelineItemProps {
  item: TimelineItemData;
  pixelsPerSecond: number;
  trackHeight: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  pixelsPerSecond,
  trackHeight,
}) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const { t } = useLocale();

  // ---------------------------------------------------------------------------
  // Store reads (selector pattern for render perf)
  // ---------------------------------------------------------------------------

  const isSelected = useTimelineStore(s => s.selectedItems.includes(item.id));
  const isDragging = useTimelineStore(s => s.isDragging);
  const isResizing = useTimelineStore(s => s.isResizing);
  const dragPreview = useTimelineStore(s =>
    s.dragPreview?.itemId === item.id ? s.dragPreview : null,
  );
  const editingSubtitleId = useTimelineStore(s => s.editingSubtitleId);
  const zoomLevel = useTimelineStore(s => s.zoomLevel);
  // Parent track's lock state — cannot come via props (Track passes only item,
  // pixelsPerSecond, trackHeight); read through selector so lock toggles re-render.
  const isTrackLocked = useTimelineStore(s => {
    const tr = s.tracks.find(t => t.id === item.trackId);
    return tr?.isLocked ?? false;
  });

  // Store actions
  const startDrag = useTimelineStore(s => s.startDrag);
  const selectItem = useTimelineStore(s => s.selectItem);
  const toggleItemSelection = useTimelineStore(s => s.toggleItemSelection);
  const deselectAll = useTimelineStore(s => s.deselectAll);
  const setEditingSubtitle = useTimelineStore(s => s.setEditingSubtitle);
  const updateItemSubtitle = useTimelineStore(s => s.updateItemSubtitle);

  // ---------------------------------------------------------------------------
  // Local UI state (subtitle editing only)
  // ---------------------------------------------------------------------------

  const isEditingSubtitle = editingSubtitleId === item.id;
  const [editingText, setEditingText] = useState('');

  // ---------------------------------------------------------------------------
  // Derived layout values — use dragPreview position when active
  // ---------------------------------------------------------------------------

  const effectiveStartTime = dragPreview ? dragPreview.startTime : item.startTime;
  const effectiveDuration = dragPreview ? dragPreview.duration : item.duration;
  const left = effectiveStartTime * pixelsPerSecond;
  const width = effectiveDuration * pixelsPerSecond;

  const isThisItemDragging = isDragging && dragPreview !== null;
  const isThisItemResizing = isResizing && dragPreview !== null;

  // ---------------------------------------------------------------------------
  // Event handlers — delegate to store
  // ---------------------------------------------------------------------------

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;

    const relativeX = e.clientX - rect.left;

    // Select the item (multi-select with Ctrl/Meta)
    if (e.ctrlKey || e.metaKey) {
      toggleItemSelection(item.id);
    } else {
      selectItem(item.id);
    }

    // Start drag via store (state machine decides move vs resize)
    startDrag({
      type: 'POINTER_DOWN',
      itemId: item.id,
      trackId: item.trackId,
      clientX: e.clientX,
      clientY: e.clientY,
      relativeX,
      itemWidth: width,
      originalStartTime: item.startTime,
      originalDuration: item.duration,
      zoomLevel,
      clipStart: item.clipStart,
      clipEnd: item.clipEnd,
      originalMediaDuration: item.originalDuration,
    });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (item.type === 'subtitle') {
      setEditingText(item.text || '');
      setEditingSubtitle(item.id);
    }
  };

  // ---------------------------------------------------------------------------
  // Subtitle inline editing handlers
  // ---------------------------------------------------------------------------

  const handleSubtitleEditComplete = () => {
    const nextText = editingText.trim();
    const prevText = (item.text ?? '').trim();
    // Only commit (and push to undo history) when the value actually changed.
    // Allow empty commits so users can clear a caption without losing the clip.
    if (nextText !== prevText) {
      updateItemSubtitle(item.id, nextText);
    }
    setEditingSubtitle(null);
    setEditingText('');
  };

  const handleSubtitleEditCancel = () => {
    setEditingSubtitle(null);
    setEditingText('');
  };

  const handleSubtitleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubtitleEditComplete();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleSubtitleEditCancel();
    }
  };

  // Keyboard interaction on the item root (a11y). Enter/Space selects the
  // item; Delete/Backspace ensures selection then lets the global panel
  // handler delete; Escape clears selection. Locked tracks + active inline
  // subtitle editing bypass this handler entirely.
  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditingSubtitle) return;
    if (isTrackLocked) return;

    switch (e.key) {
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          toggleItemSelection(item.id);
        } else {
          selectItem(item.id);
        }
        return;
      }
      case 'Delete':
      case 'Backspace': {
        if (!isSelected) {
          selectItem(item.id);
        }
        return;
      }
      case 'Escape': {
        e.preventDefault();
        deselectAll();
        return;
      }
      default:
        return;
    }
  };

  // ---------------------------------------------------------------------------
  // Styles — preserve all original visual logic
  // ---------------------------------------------------------------------------

  const getItemStyles = () => {
    const padding = Math.max(2, Math.floor(trackHeight * 0.125));
    const itemHeight = trackHeight - padding * 2;

    const baseStyles = {
      position: 'absolute' as const,
      left: `${left}px`,
      width: `${Math.max(width, 20)}px`,
      height: `${Math.max(itemHeight, 16)}px`,
      top: `${padding}px`,
      borderRadius: '3px',
      cursor: isThisItemDragging ? 'grabbing' : 'grab',
      userSelect: 'none' as const,
      transition: isThisItemDragging || isThisItemResizing ? 'none' : 'all 0.2s ease',
      zIndex: isSelected ? 10 : 1,
      opacity: isThisItemDragging ? 0.8 : 1,
    };

    switch (item.type) {
      case 'video':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent)' : 'none',
        };
      case 'audio':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(16, 185, 129, 0.3)' : 'none',
        };
      case 'subtitle':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(245, 158, 11, 0.3)' : 'none',
        };
      default:
        return baseStyles;
    }
  };

  // ---------------------------------------------------------------------------
  // Render item content — preserve all original visual rendering
  // ---------------------------------------------------------------------------

  const renderItemContent = () => {
    const padding = Math.max(2, Math.floor(trackHeight * 0.125));
    const itemHeight = trackHeight - padding * 2;
    const contentPadding = Math.max(2, Math.floor(itemHeight * 0.15));
    const iconSize = Math.max(12, Math.min(24, Math.floor(itemHeight * 0.6)));
    const fontSize = Math.max(10, Math.min(14, Math.floor(itemHeight * 0.4)));
    const thumbnailSize = Math.max(12, Math.min(20, Math.floor(itemHeight * 0.7)));

    const contentStyle = {
      padding: `${Math.floor(contentPadding / 2)}px ${contentPadding}px`,
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      overflow: 'hidden',
    };

    switch (item.type) {
      case 'video':
        return (
          <div style={contentStyle}>
            <div className="flex items-center space-x-1 min-w-0">
              {item.thumbnailUrl && (
                <img
                  src={item.thumbnailUrl}
                  alt={item.name}
                  className="rounded object-cover flex-shrink-0"
                  style={{
                    width: `${thumbnailSize}px`,
                    height: `${thumbnailSize}px`,
                  }}
                />
              )}
              <span
                className="text-white font-medium truncate"
                style={{ fontSize: `${fontSize}px` }}
              >
                {item.name}
              </span>
            </div>
            <span
              className="text-white opacity-75 flex-shrink-0 ml-1"
              style={{ fontSize: `${Math.max(8, fontSize - 2)}px` }}
            >
              {item.duration.toFixed(1)}s
            </span>
          </div>
        );
      case 'audio':
        return (
          <div style={contentStyle}>
            {item.sentenceSegments && item.sentenceSegments.sentences.length > 0 ? (
              <>
                <SentenceSegmentBar
                  sentenceSegments={item.sentenceSegments}
                  width={width}
                  height={trackHeight}
                  duration={item.duration}
                />
                <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                  <div className="flex items-center space-x-1 min-w-0">
                    <div
                      className="flex-shrink-0 "
                      style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                    >
                      <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    </div>
                    <span
                      className="text-white font-medium truncate "
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 flex-shrink-0">
                    <span
                      className="text-white opacity-90 bg-black bg-opacity-30 px-1.5 py-0.5 rounded text-xs font-medium "
                      style={{ fontSize: `${Math.max(8, fontSize - 2)}px` }}
                    >
                      {item.sentenceSegments.sentences.length} 句
                    </span>
                    <span
                      className="text-white opacity-75 "
                      style={{ fontSize: `${Math.max(8, fontSize - 2)}px` }}
                    >
                      {item.duration.toFixed(1)}s
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-1 min-w-0">
                  <div
                    className="flex-shrink-0"
                    style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                  >
                    <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                    </svg>
                  </div>
                  <span
                    className="text-white font-medium truncate"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center space-x-0.5 flex-shrink-0">
                  {[...Array(Math.max(3, Math.min(8, Math.floor(iconSize / 2))))].map((_, i) => (
                    <div
                      key={i}
                      className="w-0.5 bg-white opacity-60"
                      style={{
                        height: `${Math.max(2, (((i * 7 + 3) % 11) / 11) * (iconSize * 0.6) + 2)}px`,
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      case 'subtitle':
        return (
          <div style={contentStyle}>
            {isEditingSubtitle ? (
              <div className="flex items-center space-x-1 min-w-0 w-full">
                <input
                  type="text"
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={handleSubtitleEditKeyDown}
                  onBlur={handleSubtitleEditComplete}
                  className="flex-1 bg-transparent text-white font-medium border-none outline-none"
                  style={{
                    minWidth: '0',
                    fontSize: `${fontSize}px`,
                  }}
                  autoFocus
                  placeholder={t.timeline.subtitleEditModal.placeholder}
                />
              </div>
            ) : (
              <div className="flex items-center space-x-1 min-w-0">
                <div
                  className="flex-shrink-0"
                  style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                >
                  <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                  </svg>
                </div>
                <span
                  className="text-white font-medium truncate"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {item.text || item.name}
                </span>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={itemRef}
      role="button"
      tabIndex={isTrackLocked ? -1 : 0}
      aria-pressed={isSelected}
      aria-disabled={isTrackLocked || undefined}
      aria-label={
        `${item.name} ` +
        `${formatTimelineTime(item.startTime, { showMs: true })}–` +
        `${formatTimelineTime(item.startTime + item.duration, { showMs: true })}` +
        `${isSelected ? ` (${t.timeline.track.selected})` : ''}` +
        `${isTrackLocked ? ` (${t.timeline.track.trackLocked})` : ''}`
      }
      style={getItemStyles()}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleItemKeyDown}
      className="timeline-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      data-clip-id={item.id}
      title={
        `${item.name} ` +
        `${formatTimelineTime(item.startTime, { showMs: true })} - ` +
        `${formatTimelineTime(item.startTime + item.duration, { showMs: true })}`
      }
    >
      {renderItemContent()}

      {/* Resize handles */}
      {isSelected && (
        <>
          <div
            className="absolute left-0 top-0 w-1.5 h-full cursor-ew-resize bg-white bg-opacity-30 hover:bg-opacity-50"
            style={{ borderRadius: '3px 0 0 3px' }}
          />
          <div
            className="absolute right-0 top-0 w-1.5 h-full cursor-ew-resize bg-white bg-opacity-30 hover:bg-opacity-50"
            style={{ borderRadius: '0 3px 3px 0' }}
          />
        </>
      )}
    </div>
  );
};

export default TimelineItem;
