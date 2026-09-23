import type { CSSProperties } from 'react';
import type { TimelineItemData } from './domain/types';
import { CLIP } from './theme/timelineTheme';

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
  /**
   * Linked to the selected script segment (spec §3.8). The ring itself is the
   * `ws-item-linked` class; here it only lifts the clip one layer so the ring
   * is not painted over by its neighbour.
   */
  isLinked?: boolean;
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
    isLinked = false,
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
    borderRadius: `${CLIP.radius}px`,
    cursor: isThisItemDragging ? 'grabbing' : 'grab',
    userSelect: 'none' as const,
    transition: isThisItemDragging || isThisItemResizing ? 'none' : 'all 0.2s ease',
    zIndex: isSwapTarget ? 9 : isSelected ? 10 : isLinked ? 2 : 1,
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

  // Visual refinements (non-asserted props only, per spec §2.6): a subtle top
  // sheen over the per-type color gradient, a dark 1px definition border so
  // adjacent clips separate cleanly, and a soft depth shadow on idle bars.
  const clipBackground =
    `linear-gradient(180deg, ${CLIP.sheen} 0%, transparent 42%), ` +
    `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`;
  const idleBorder = `1px solid ${CLIP.border}`;
  const depthShadow = '0 1px 3px rgba(0, 0, 0, 0.30)';

  switch (item.type) {
    case 'video':
      return {
        ...baseStyles,
        background: clipBackground,
        border: isSelected ? '2px solid var(--primary)' : idleBorder,
        boxShadow: isSelected ? '0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent)' : depthShadow,
        ...(swapTargetStyles ?? {}),
      };
    case 'audio':
      return {
        ...baseStyles,
        background: clipBackground,
        border: isSelected ? '2px solid #10b981' : idleBorder,
        boxShadow: isSelected ? '0 0 0 2px rgba(16, 185, 129, 0.3)' : depthShadow,
        ...(swapTargetStyles ?? {}),
      };
    case 'subtitle':
      return {
        ...baseStyles,
        background: clipBackground,
        border: isSelected ? '2px solid #f59e0b' : idleBorder,
        boxShadow: isSelected ? '0 0 0 2px rgba(245, 158, 11, 0.3)' : depthShadow,
      };
    default:
      return baseStyles;
  }
}
