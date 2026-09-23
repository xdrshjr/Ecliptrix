/**
 * useSegmentListFocus — selection, expansion, roving focus and scroll sync of
 * the script segment list (spec §3.4.3 / §3.5.2, RV-07).
 *
 * - The selected card is the expanded one; selecting never moves the
 *   playhead and never touches the right-panel tab (iron rule, §3.4.1).
 * - A timeline-driven selection, or the playing card while "跟随播放" is on,
 *   is scrolled into view — unless the user is typing inside the left panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useEditorFocusStore } from '@/stores/editorFocusStore';

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

/** True while focus sits in an editable control inside `panel`. */
export function isEditingInside(panel: HTMLElement | null): boolean {
  if (!panel || typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !panel.contains(active)) return false;
  return active.matches(EDITABLE_SELECTOR);
}

export interface SegmentListFocus {
  selectedSegmentId: string | null;
  expandedSegmentId: string | null;
  /** Segment whose header carries `tabIndex=0` (roving tabindex). */
  tabStopSegmentId: string | null;
  select(segmentId: string): void;
  toggleExpanded(segmentId: string): void;
  expand(segmentId: string): void;
  collapse(segmentId: string): void;
  navigate(fromSegmentId: string, delta: 1 | -1): void;
  registerHeader(segmentId: string, element: HTMLButtonElement | null): void;
  registerCard(segmentId: string, element: HTMLElement | null): void;
  focusHeader(segmentId: string): void;
}

interface UseSegmentListFocusInput {
  segmentIds: readonly string[];
  playingSegmentId: string | null;
  panelRef: RefObject<HTMLElement | null>;
}

export function useSegmentListFocus(input: UseSegmentListFocusInput): SegmentListFocus {
  const { segmentIds, playingSegmentId, panelRef } = input;
  const selectedSegmentId = useEditorFocusStore((state) => state.selectedSegmentId);
  const selectionSource = useEditorFocusStore((state) => state.selectionSource);
  const followPlayback = useEditorFocusStore((state) => state.followPlayback);
  const selectSegment = useEditorFocusStore((state) => state.selectSegment);
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(selectedSegmentId);
  const headers = useRef(new Map<string, HTMLButtonElement>());
  const cards = useRef(new Map<string, HTMLElement>());

  // Expansion follows selection: whichever card becomes selected opens.
  useEffect(() => {
    setExpandedSegmentId(selectedSegmentId);
  }, [selectedSegmentId]);

  const scrollIntoViewGuarded = useCallback((segmentId: string | null) => {
    if (!segmentId || isEditingInside(panelRef.current)) return;
    cards.current.get(segmentId)?.scrollIntoView?.({ block: 'nearest' });
  }, [panelRef]);

  useEffect(() => {
    if (selectionSource === 'timeline') scrollIntoViewGuarded(selectedSegmentId);
  }, [selectedSegmentId, selectionSource, scrollIntoViewGuarded]);

  useEffect(() => {
    if (followPlayback) scrollIntoViewGuarded(playingSegmentId);
  }, [followPlayback, playingSegmentId, scrollIntoViewGuarded]);

  const select = useCallback((segmentId: string) => {
    selectSegment(segmentId, 'script');
    setExpandedSegmentId(segmentId);
  }, [selectSegment]);

  const toggleExpanded = useCallback((segmentId: string) => {
    if (useEditorFocusStore.getState().selectedSegmentId !== segmentId) {
      select(segmentId);
      return;
    }
    setExpandedSegmentId((current) => (current === segmentId ? null : segmentId));
  }, [select]);

  const collapse = useCallback((segmentId: string) => {
    setExpandedSegmentId((current) => (current === segmentId ? null : current));
  }, []);

  const focusHeader = useCallback((segmentId: string) => {
    headers.current.get(segmentId)?.focus();
  }, []);

  const navigate = useCallback((fromSegmentId: string, delta: 1 | -1) => {
    const target = segmentIds[segmentIds.indexOf(fromSegmentId) + delta];
    if (!target) return;
    select(target);
    focusHeader(target);
  }, [segmentIds, select, focusHeader]);

  const registerHeader = useCallback((segmentId: string, element: HTMLButtonElement | null) => {
    if (element) headers.current.set(segmentId, element);
    else headers.current.delete(segmentId);
  }, []);

  const registerCard = useCallback((segmentId: string, element: HTMLElement | null) => {
    if (element) cards.current.set(segmentId, element);
    else cards.current.delete(segmentId);
  }, []);

  const hasSelection = selectedSegmentId !== null && segmentIds.includes(selectedSegmentId);
  return {
    selectedSegmentId,
    expandedSegmentId,
    tabStopSegmentId: hasSelection ? selectedSegmentId : (segmentIds[0] ?? null),
    select,
    toggleExpanded,
    expand: select,
    collapse,
    navigate,
    registerHeader,
    registerCard,
    focusHeader,
  };
}
