'use client';

import React, { useEffect, useId, useRef, useState } from 'react';

export interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  confirmButtonClass,
  onConfirm,
  onCancel,
  type = 'danger'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  // The dialog element itself is the focus fallback (tabIndex -1): a click
  // on its text must keep focus inside [aria-modal], or timeline shortcuts
  // (Delete, Ctrl+Z) and global Space fire behind the open confirmation.
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (isOpen) {
      // Remember where focus was so closing hands it back (keyboard users
      // otherwise land on <body> and lose their place in the editor).
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        restoreFocusRef.current = document.activeElement;
      }
      setIsVisible(true);
      const timer = setTimeout(() => setIsAnimating(true), 10);
      return () => clearTimeout(timer);
    }
    setIsAnimating(false);
    const previous = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (previous && previous.isConnected) {
      previous.focus();
    }
    const timer = setTimeout(() => setIsVisible(false), 200);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Move focus into the dialog as soon as it is mounted. The safe choice
  // (cancel) gets it, so a stray Enter never confirms a destructive action,
  // and Escape / keyboard shortcuts are scoped to the dialog.
  useEffect(() => {
    if (isOpen && isVisible) {
      cancelButtonRef.current?.focus();
    }
  }, [isOpen, isVisible]);

  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleCancel();
    }
  };

  // Tab wraps between the dialog's buttons (also from the dialog element
  // itself), so keyboard focus can never walk out to the editor behind it.
  const trapTabFocus = (e: React.KeyboardEvent) => {
    const root = dialogRef.current;
    if (!root) return;
    const focusables: HTMLElement[] = Array.prototype.slice.call(
      root.querySelectorAll('button:not([disabled])'),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const isOnButton = active !== null && focusables.indexOf(active) >= 0;
    const edge = e.shiftKey ? first : last;
    if (!isOnButton || active === edge) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      trapTabFocus(e);
    } else if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      // A focused button activates itself on Enter; confirming here as well
      // would turn "Enter on Cancel" into a confirmation.
      handleConfirm();
    }
  };

  const getIconColor = () => {
    switch (type) {
      case 'danger':
        return 'text-destructive';
      case 'warning':
        return 'text-yellow-500';
      default:
        return 'text-primary';
    }
  };

  const getDefaultConfirmButtonClass = () => {
    if (confirmButtonClass) return confirmButtonClass;

    switch (type) {
      case 'danger':
        return 'bg-destructive text-destructive-foreground hover:opacity-90';
      case 'warning':
        return 'bg-yellow-600 text-white hover:opacity-90';
      default:
        return 'bg-primary text-primary-foreground hover:opacity-90';
    }
  };

  const renderIcon = () => {
    const iconClass = `w-6 h-6 ${getIconColor()}`;

    switch (type) {
      case 'danger':
        return (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        );
      case 'warning':
        return (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center p-4 transition-all duration-200 ${
        isAnimating ? 'bg-black/60' : 'bg-black/0'
      }`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`bg-card rounded-md shadow-xl border border-border max-w-md w-full outline-none transform transition-all duration-200 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-start p-6 pb-4">
          <div className="flex-shrink-0 mr-4">
            {renderIcon()}
          </div>
          <div className="flex-1">
            <h3
              id={titleId}
              className="text-sm font-semibold text-foreground mb-2"
            >
              {title}
            </h3>
            <p
              id={descriptionId}
              className="text-sm text-muted-foreground leading-relaxed"
            >
              {message}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border rounded-b-md">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-colors ${getDefaultConfirmButtonClass()}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationDialog;