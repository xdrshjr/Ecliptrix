'use client';

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { trapTabKey } from '@/components/ui/focusTrap';

export interface SegmentDialogShellProps {
  title: string;
  /** Dialog width (px); the dialog never exceeds the viewport. */
  width?: number;
  onClose(): void;
  /** Footer buttons; the first `[data-autofocus]` or the first button gets focus. */
  footer: React.ReactNode;
  children: React.ReactNode;
  /** Tone of the title icon strip: danger for deletions. */
  tone?: 'default' | 'danger';
  testId?: string;
}

function resolvePortalRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const scoped = document.querySelector('.editor-workbench');
  return scoped instanceof HTMLElement ? scoped : document.body;
}

/**
 * Modal shell shared by the segment command dialogs (spec R2 §3.4–§3.12).
 * Rendered inside `.editor-workbench` so the `--ws-*` tokens apply; focus is
 * trapped (timeline shortcuts must not fire behind it) and returned on close;
 * Esc cancels and never applies anything.
 */
const SegmentDialogShell: React.FC<SegmentDialogShellProps> = (props) => {
  const { title, width = 440, onClose, footer, children, tone = 'default', testId } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const target = dialog?.querySelector<HTMLElement>('[data-autofocus]')
      ?? dialog?.querySelector<HTMLElement>('button, input');
    (target ?? dialog)?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') {
      trapTabKey(event, dialogRef.current);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }
    // Keys typed inside the dialog never reach the editor's shortcuts.
    event.stopPropagation();
  };

  const root = resolvePortalRoot();
  if (!root) return null;
  return createPortal(
    <div
      className="ws-dialog-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ws-dialog"
        data-tone={tone}
        data-testid={testId}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="ws-dialog__title">{title}</h2>
        <div className="ws-dialog__body">{children}</div>
        <div className="ws-dialog__footer">{footer}</div>
      </div>
    </div>,
    root,
  );
};

export default SegmentDialogShell;

/** Bulleted impact lines (nothing rendered for an empty list). */
export const ImpactLines: React.FC<{ lines: readonly string[] }> = ({ lines }) => (
  lines.length === 0 ? null : (
    <ul className="ws-dialog__impact">
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  )
);
