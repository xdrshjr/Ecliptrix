'use client';

import React, { useEffect, useRef } from 'react';

import { useLocale } from '@/contexts/LocaleContext';
import type { CoverTextLayer } from '../types';

const KNOWN_LAYER_KEYS = new Set(['badge', 'title', 'subtitle', 'eyebrow', 'cta']);

const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

interface EditableTextLayerProps {
  layer: CoverTextLayer;
  isEditing: boolean;
  /** Caller-provided trigger to enter edit mode (called on double-click). */
  onStartEdit: () => void;
  /** Submit the new text content. Called on blur, Esc, and Enter without IME composition. */
  onCommitText: (next: string) => void;
  /** Notify the modal that this layer was clicked (for selection styling). */
  onSelect: () => void;
  /** True when this layer is the currently selected one (toolbar bound to it). */
  selected: boolean;
}

/**
 * One contenteditable text layer. Positioned absolutely inside the parent
 * preview container using the layer's normalized x/y/width.
 *
 * IME-safe: ``Enter`` does NOT commit while a CJK composition is in progress
 * (``isComposingRef`` tracks ``compositionstart`` / ``compositionend``).
 */
export const EditableTextLayer: React.FC<EditableTextLayerProps> = ({
  layer,
  isEditing,
  onStartEdit,
  onCommitText,
  onSelect,
  selected,
}) => {
  const elRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const { t } = useLocale();

  const a11yLabels = t.videoCoverModal?.a11y;
  const layerKey = layer.key;
  const ariaLabel = (() => {
    if (!a11yLabels) return `${capitalize(layerKey)} text`;
    if (KNOWN_LAYER_KEYS.has(layerKey)) {
      const specificKey = `layer${capitalize(layerKey)}` as keyof typeof a11yLabels;
      const v = a11yLabels[specificKey];
      if (typeof v === 'string') return v;
    }
    return (a11yLabels.layerGeneric ?? '{key} text').replace('{key}', capitalize(layerKey));
  })();
  const placeholder = ariaLabel;

  // Keep DOM text in sync when ``layer.text`` changes from the outside
  // (template switch carries text over by key) — but only when not editing,
  // to avoid clobbering the user's caret.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (!isEditing && el.textContent !== layer.text) {
      el.textContent = layer.text;
    }
  }, [layer.text, isEditing]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing) {
      const el = elRef.current;
      if (el) {
        el.focus();
        // Place caret at end of content
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
  }, [isEditing]);

  const commit = () => {
    const el = elRef.current;
    if (!el) return;
    const text = (el.textContent ?? '').replace(/ /g, ' ');
    if (text !== layer.text) {
      onCommitText(text);
    }
  };

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${layer.x * 100}%`,
    top: `${layer.y * 100}%`,
    width: `${layer.width * 100}%`,
    fontFamily: layer.fontFamily,
    // Preview canvas is sized by the parent's intrinsic aspect ratio; font
    // sizing uses ``vmin``-style relative units via a CSS var injected by
    // CoverPreview. Here we just translate the px-at-1080-short-side value
    // into a relative ``em``-style scale by treating 1080 px as 100 cqh.
    fontSize: `calc(${layer.fontSize} * var(--cover-px, 0.001))`,
    color: layer.color,
    fontWeight: layer.fontWeight,
    fontStyle: layer.italic ? 'italic' : 'normal',
    textDecoration: layer.underline ? 'underline' : 'none',
    textAlign: layer.align,
    cursor: isEditing ? 'text' : 'pointer',
    outline: selected ? '1px dashed currentColor' : 'none',
    outlineOffset: '2px',
    userSelect: isEditing ? 'text' : 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.15,
  };

  return (
    <div
      ref={elRef}
      className="cover-text-layer"
      style={style}
      contentEditable={isEditing}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      onClick={(e) => {
        if (!isEditing) {
          e.stopPropagation();
          onSelect();
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
      }}
      onBlur={() => {
        if (isEditing) commit();
      }}
      onKeyDown={(e) => {
        if (!isEditing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLDivElement).blur();
        } else if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
          // Single Enter (no Shift, not in CJK composition) commits + exits.
          // Shift+Enter inserts a newline (default browser behavior).
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLDivElement).blur();
        }
      }}
    >
      {/* Initial children — useEffect keeps these in sync afterwards */}
      {layer.text}
    </div>
  );
};

export default EditableTextLayer;
