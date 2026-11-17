'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

/** A nested keyboard boundary independent of the outer Modal focus list. */
export function EffectsCloseDialog(options: {
  onContinue: () => void;
  onDiscard: () => void | Promise<void>;
  onSave: () => unknown | Promise<unknown>;
  onClosed: () => void | Promise<void>;
}) {
  const { t } = useLocale();
  const labels = t.effects.labels;
  const titleId = useId(), descriptionId = useId();
  const root = useRef<HTMLDivElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const intent = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    keepEditing.current?.focus();
    return () => {
      intent.current++;
      queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
    };
  }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  const resume = () => { intent.current++; options.onContinue(); };
  const finish = async (discard = false) => {
    if (saving) return;
    const token = ++intent.current;
    setSaving(true); setError(undefined);
    try {
      if (discard) await options.onDiscard(); else await options.onSave();
      if (intent.current === token) await options.onClosed();
    } catch (failure) {
      if (intent.current === token) {
        const code = failure instanceof Error ? failure.message : '';
        setError(t.effects.errors[code] ?? labels.failed);
      }
    } finally { if (intent.current === token) setSaving(false); }
  };
  return <div ref={root} role="alertdialog" aria-modal="true"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onKeyDownCapture={event => {
      if (composing.current || event.nativeEvent.isComposing
        || event.keyCode === 229) { event.stopPropagation(); return; }
      // Background draft and timeline shortcuts must not cross the dialog.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); resume();
      }
      if (event.key !== 'Tab') return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(
        'button:not([disabled])') ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = (index + (event.shiftKey ? -1 : 1) + buttons.length)
        % buttons.length;
      buttons[next]?.focus();
    }}
    className="absolute inset-0 z-10 grid place-items-center overflow-auto bg-background/80 p-6">
    <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl space-y-4">
      <h3 id={titleId} className="font-medium">{labels.unsaved}</h3>
      <p id={descriptionId} className="text-sm text-muted-foreground">
        {labels.sentSaveNotice}</p>
      {error && <p ref={errorSummary} tabIndex={-1} role="alert"
        className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" disabled={saving} onClick={() => void finish()}
          className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-40">
          {labels.saveClose}</button>
        <button type="button" disabled={saving} onClick={() => void finish(true)}
          className="px-2 py-2 disabled:opacity-40">{labels.discard}</button>
        <button ref={keepEditing} type="button" onClick={resume}
          className="rounded border border-border px-3 py-2">{labels.continue}</button>
      </div>
    </div>
  </div>;
}
