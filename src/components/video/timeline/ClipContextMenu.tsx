import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** A body portal keeps clip actions reachable inside overflow-clipped lanes. */
export function ClipContextMenu(options: { x: number; y: number;
  onClose: () => void;
  actions: { label: string; run: () => void; disabled?: boolean }[] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) options.onClose();
    };
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('pointerdown', close);
      previous?.focus(); };
  }, []);
  return createPortal(<div ref={root} role="menu"
    className="fixed z-[1000] min-w-40 rounded-lg border border-border bg-background p-1 shadow-xl"
    style={{ left: Math.max(4, Math.min(options.x, window.innerWidth - 220)),
      top: Math.max(4, Math.min(options.y, window.innerHeight - 120)) }}
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); options.onClose();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = Array.from(root.current!.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1))
          % buttons.length]?.focus();
      }
    }}>
    {options.actions.map(action => <button key={action.label} type="button"
      role="menuitem" disabled={action.disabled}
      className="block w-full rounded px-3 py-2 text-left text-xs hover:bg-muted focus:bg-muted disabled:opacity-40"
      onClick={event => {
        event.stopPropagation(); options.onClose(); action.run();
      }}>{action.label}</button>)}
  </div>, document.body);
}
