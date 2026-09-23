'use client';

/**
 * 「画布 16:9 ▾」 dropdown in the preview header (spec §3.6).
 *
 * Holds what used to be the Player Console settings row — the aspect-ratio
 * choice and the cover entry — plus the read-only 「视频 3 · 音频 2」 line that
 * replaced the header count chips. The ratio is controlled by the parent;
 * this component only owns whether the menu is open.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AspectRatio } from './aspectRatios';

export interface CanvasMenuProps {
  aspectRatios: AspectRatio[];
  selectedId: string;
  onSelect(ratio: AspectRatio): void;
  videoCount: number;
  audioCount: number;
  /** The cover entry (CoverButton); omitted when no project is bound. */
  coverSlot?: React.ReactNode;
}

const ARROW_STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/** Close the menu on Escape anywhere inside it and on a press outside it. */
function useDismiss(
  isOpen: boolean,
  rootRef: React.RefObject<HTMLDivElement | null>,
  close: (restoreFocus: boolean) => void,
): void {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, rootRef, close]);
}

const CanvasMenu: React.FC<CanvasMenuProps> = ({
  aspectRatios,
  selectedId,
  onSelect,
  videoCount,
  audioCount,
  coverSlot,
}) => {
  const { t } = useLocale();
  const copy = t.workbench.canvas;
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const selectedIndex = Math.max(
    0,
    aspectRatios.findIndex((ratio) => ratio.id === selectedId),
  );
  const selectedLabel = aspectRatios[selectedIndex]?.label ?? selectedId;

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  useDismiss(isOpen, rootRef, close);

  // Opening moves focus to the checked radio (roving tab stop).
  useEffect(() => {
    if (isOpen) radioRefs.current[selectedIndex]?.focus();
  }, [isOpen, selectedIndex]);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    // A closed menu leaves Escape to the editor's own handlers.
    if (event.key !== 'Escape' || !isOpen) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  // Radio-group semantics: arrows move AND select, wrapping at the ends.
  const handleRadioKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step = ARROW_STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const count = aspectRatios.length;
    const next = (index + step + count) % count;
    onSelect(aspectRatios[next]);
    radioRefs.current[next]?.focus();
  };

  return (
    <div className="ws-canvas-menu" ref={rootRef} onKeyDown={handleMenuKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="ws-btn ws-btn--ghost ws-btn--sm ws-canvas-trigger"
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="ws-tabular">
          {copy.menu.replace('{ratio}', selectedLabel)}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={1.75} aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div id={menuId} className="ws-menu ws-canvas-popover" aria-label={copy.title}>
          <div role="radiogroup" aria-label={t.videoPlayerPanel.info.aspectRatio}>
            {aspectRatios.map((ratio, index) => {
              const isChecked = index === selectedIndex;
              return (
                <button
                  key={ratio.id}
                  ref={(node) => { radioRefs.current[index] = node; }}
                  type="button"
                  role="radio"
                  aria-checked={isChecked}
                  tabIndex={isChecked ? 0 : -1}
                  className="ws-menu-item ws-canvas-ratio"
                  onClick={() => onSelect(ratio)}
                  onKeyDown={(event) => handleRadioKeyDown(event, index)}
                >
                  <span className="ws-canvas-ratio-mark" aria-hidden="true" />
                  <span className="ws-canvas-ratio-label ws-tabular">{ratio.label}</span>
                  <span className="ws-canvas-ratio-desc">{ratio.description}</span>
                </button>
              );
            })}
          </div>
          <p className="ws-menu-note">{copy.ratioNote}</p>
          {coverSlot && (
            <>
              <div className="ws-menu-sep" role="separator" />
              {/* The cover modal opens from the slot; the menu gets out of its way. */}
              <div className="ws-canvas-cover" onClick={() => close(false)}>
                {coverSlot}
              </div>
            </>
          )}
          <div className="ws-menu-sep" role="separator" />
          <p className="ws-menu-note ws-tabular" data-testid="canvas-menu-counts">
            {copy.counts
              .replace('{video}', String(videoCount))
              .replace('{audio}', String(audioCount))}
          </p>
        </div>
      )}
    </div>
  );
};

export default CanvasMenu;
