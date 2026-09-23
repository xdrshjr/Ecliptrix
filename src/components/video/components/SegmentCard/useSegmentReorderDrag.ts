'use client';

/**
 * useSegmentReorderDrag — drag handle + keyboard reorder of segment cards,
 * and the material drop that replaces a segment's picture (spec R2 §3.6 C /
 * §3.8).
 *
 * Two drags share the cards, so each has its own MIME type (R-10): a segment
 * drag carries `application/x-ecliptrix-segment` and only starts from the
 * handle; a material drag is recognised by the material type MIME the
 * materials panel already writes. dragover can read types but not data.
 */

import { useCallback, useState } from 'react';
import type React from 'react';
import type { MaterialItem } from '@/types';
import { readDraggedMaterialType } from '../../timeline/lib/materialDragTypes';

export const SEGMENT_DRAG_MIME = 'application/x-ecliptrix-segment';

export type CardDropState =
  | { kind: 'none' }
  | { kind: 'reorder'; segmentId: string; insertAt: number }
  | { kind: 'material'; segmentId: string; accepts: boolean };

export interface SegmentDragCallbacks {
  /** Move `segmentId` to `toIndex` in the script order. */
  onMove(segmentId: string, toIndex: number): void;
  /** Replace the segment's picture with the dropped material. */
  onReplaceVisual(segmentId: string, materialId: string): void;
}

export interface SegmentReorderDrag {
  dropState: CardDropState;
  handleProps(segmentId: string, index: number, count: number): React.HTMLAttributes<HTMLElement> & {
    draggable: boolean;
  };
  cardDropProps(segmentId: string, index: number): React.HTMLAttributes<HTMLElement>;
}

function hasType(event: React.DragEvent, type: string): boolean {
  return Array.from(event.dataTransfer.types).some((entry) => entry.toLowerCase() === type);
}

/** Material id of a finished material drop, or null for anything else. */
export function readDroppedMaterialId(raw: string): string | null {
  // No JSON payload (e.g. files from the desktop): not a material drop.
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { type?: string; material?: Pick<MaterialItem, 'id'> };
    return parsed.type === 'material' && typeof parsed.material?.id === 'string' ? parsed.material.id : null;
  } catch (error) {
    console.warn('[useSegmentReorderDrag] unreadable drop payload', error);
    return null;
  }
}

/** Old index → target index for an insertion point in the old list (0..n). */
export function insertionToIndex(fromIndex: number, insertAt: number): number {
  return fromIndex < insertAt ? insertAt - 1 : insertAt;
}

export function isVisualMaterialType(type: MaterialItem['type'] | null): boolean {
  return type === 'video' || type === 'image';
}

// Hook exceeds 60 lines by design: the reorder and material drops share one
// drop state so a card never shows both hints at once.
export function useSegmentReorderDrag(
  segmentIds: readonly string[],
  callbacks: SegmentDragCallbacks,
): SegmentReorderDrag {
  const [dropState, setDropState] = useState<CardDropState>({ kind: 'none' });
  const [dragging, setDragging] = useState<string | null>(null);
  const clear = useCallback(() => setDropState({ kind: 'none' }), []);

  const handleProps = useCallback((segmentId: string, index: number, count: number) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.setData(SEGMENT_DRAG_MIME, segmentId);
      event.dataTransfer.effectAllowed = 'move';
      setDragging(segmentId);
    },
    onDragEnd: () => { setDragging(null); clear(); },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      event.stopPropagation();
      const target = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (target >= 0 && target < count) callbacks.onMove(segmentId, target);
    },
  }), [callbacks, clear]);

  const cardDropProps = useCallback((segmentId: string, index: number) => ({
    onDragOver: (event: React.DragEvent) => {
      if (hasType(event, SEGMENT_DRAG_MIME)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect();
        const insertAt = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
        if (dropState.kind !== 'reorder' || dropState.insertAt !== insertAt) {
          setDropState({ kind: 'reorder', segmentId, insertAt });
        }
        return;
      }
      const materialType = readDraggedMaterialType(Array.from(event.dataTransfer.types));
      if (materialType === null) return;
      const accepts = isVisualMaterialType(materialType);
      if (accepts) event.preventDefault();
      event.dataTransfer.dropEffect = accepts ? 'copy' : 'none';
      if (dropState.kind !== 'material' || dropState.segmentId !== segmentId || dropState.accepts !== accepts) {
        setDropState({ kind: 'material', segmentId, accepts });
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      if (dropState.kind === 'material' && dropState.segmentId === segmentId) clear();
    },
    onDrop: (event: React.DragEvent) => {
      const state = dropState;
      clear();
      const movedId = event.dataTransfer.getData(SEGMENT_DRAG_MIME) || dragging;
      if (hasType(event, SEGMENT_DRAG_MIME) && movedId) {
        event.preventDefault();
        const from = segmentIds.indexOf(movedId);
        const insertAt = state.kind === 'reorder' ? state.insertAt : index;
        if (from >= 0) {
          const to = insertionToIndex(from, insertAt);
          if (to !== from) callbacks.onMove(movedId, to);
        }
        return;
      }
      const materialId = readDroppedMaterialId(event.dataTransfer.getData('application/json'));
      if (!materialId) return;
      event.preventDefault();
      event.stopPropagation();
      callbacks.onReplaceVisual(segmentId, materialId);
    },
  }), [callbacks, clear, dragging, dropState, segmentIds]);

  return { dropState, handleProps, cardDropProps };
}
