import type { CSSProperties } from 'react';
import type { TimelineItemData } from './domain/types';

/**
 * Inputs for {@link computeItemStyles}. Grouped into a config object so the
 * pure style computation never grows a long positional parameter list as the
 * timeline item gains visual states.
 */
export interface ItemStyleInputs {
  item: TimelineItemData;
  trackHeight: number;
  left: number;
  width: number;
  isSelected: boolean;
  isThisItemDragging: boolean;
  isThisItemResizing: boolean;
  isSwapTarget: boolean;
  hasActiveSwapTarget: boolean;
}

/**
 * Compute the absolute-positioned clip bar style. Lifted verbatim from
 * TimelineItem (`getItemStyles`) so the renderer stays lean; all original
 * visual logic (per-type borders/glow, swap-target outline, drag opacity) is
 * preserved.
 */
export function computeItemStyles(inputs: ItemStyleInputs): CSSProperties {
  const {
    item,
    trackHeight,
    left,
    width,
    isSelected,
    isThisItemDragging,
    isThisItemResizing,
    isSwapTarget,
    hasActiveSwapTarget,
  } = inputs;

  const padding = Math.max(2, Math.floor(trackHeight * 0.125));
  const itemHeight = trackHeight - padding * 2;

  // When a swap target is under the dragged item's center, fade the
  // dragged item more heavily so the highlighted target is clearly read.
  const draggedOpacity = hasActiveSwapTarget ? 0.65 : 0.8;

  const baseStyles: CSSProperties = {
    position: 'absolute' as const,
    left: `${left}px`,
    width: `${Math.max(width, 20)}px`,
    height: `${Math.max(itemHeight, 16)}px`,
    top: `${padding}px`,
    borderRadius: '3px',
    cursor: isThisItemDragging ? 'grabbing' : 'grab',
    userSelect: 'none' as const,
    transition: isThisItemDragging || isThisItemResizing ? 'none' : 'all 0.2s ease',
    zIndex: isSwapTarget ? 9 : (isSelected ? 10 : 1),
    opacity: isThisItemDragging ? draggedOpacity : 1,
  };

  // Swap-target overlay: dashed cyan outline + glow.
  const swapTargetStyles = isSwapTarget
    ? {
        outline: '2px dashed #22d3ee',
        outlineOffset: '1px',
        boxShadow: '0 0 0 4px rgba(34, 211, 238, 0.25)',
      }
    : null;

  switch (item.type) {
    case 'video':
      return {
        ...baseStyles,
        background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
        border: isSelected ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.2)',
        boxShadow: isSelected ? '0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent)' : 'none',
        ...(swapTargetStyles ?? {}),
      };
    case 'audio':
      return {
        ...baseStyles,
        background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
        border: isSelected ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.2)',
        boxShadow: isSelected ? '0 0 0 2px rgba(16, 185, 129, 0.3)' : 'none',
        ...(swapTargetStyles ?? {}),
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
}
