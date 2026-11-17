'use client';
import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/ui/Modal';
import { useLocale } from '@/contexts/LocaleContext';
import { getEffectRenderability,
  validateEffectDocument } from '@/lib/effects/validation';
import type { MaterialItem } from '@/types';
import type { EffectsController } from './useEffectsController';
import { EffectsLibrary } from './EffectsLibrary';
import { EffectsInspector } from './EffectsInspector';
import { EffectsJobCard } from './EffectsJobCard';

const EffectsPreview = dynamic(() => import('./EffectsPreview'), { ssr: false });

export function EffectsStudioModal(options: {
  controller: EffectsController; materials: MaterialItem[];
}) {
  const { t } = useLocale();
  const { controller } = options;
  const [tab, setTab] = useState('edit');
  const [applicationMode, setApplicationMode] = useState<'insert' | 'replace'>();
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    setApplicationMode(undefined);
    setConfirmClose(false);
  }, [controller.isOpen, controller.target]);
  if (!controller.isOpen) return null;
  const { draft } = controller;
  const mode = controller.target ? applicationMode ?? 'replace' : 'insert';
  const labels = t.effects.labels;
  let isValid = true;
  try { validateEffectDocument(draft.document); } catch { isValid = false; }
  const canRender = isValid && getEffectRenderability(draft.document).ready
    && controller.capability?.ready && draft.status !== 'conflict'
    && !draft.draft?.readOnly && !controller.busy;
  const close = () => {
    if (confirmClose) { setConfirmClose(false); return; }
    if (draft.dirty || draft.status === 'saving') setConfirmClose(true);
    else controller.close();
  };
  const error = controller.error ?? draft.error ?? controller.jobs.error;
  const code = error && 'code' in error ? String(error.code) : error?.message;
  return createPortal(<Modal isOpen onClose={close}
    labelledBy="effects-studio-title" closeOnBackdrop={false}
    contentClassName="effects-studio flex flex-col bg-background text-foreground rounded-xl border border-border shadow-2xl overflow-hidden"
  >
    <div data-effects-studio className="flex flex-col flex-1 min-h-0"
      onKeyDown={event => {
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault(); draft.undo(event.shiftKey);
        }
      }}>
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <h2 id="effects-studio-title" className="font-medium whitespace-nowrap">
          {labels.title}
        </h2>
        <select aria-label={labels.drafts} value={draft.draft?.id ?? ''}
          className="max-w-40 rounded border border-border bg-background p-1 text-xs"
          onChange={event => void controller.open(event.target.value
            ? { draftId: event.target.value } : { newDraft: true })}>
          <option value="">{labels.newDraft}</option>
          {controller.drafts.map(item => <option key={item.id} value={item.id}>
            {item.name}</option>)}
          {draft.draft && !controller.drafts.some(item => item.id === draft.draft!.id)
            && <option value={draft.draft.id}>{draft.name}</option>}
        </select>
        <input aria-label={labels.name} value={draft.name}
          readOnly={draft.draft?.readOnly}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none focus:ring-1 focus:ring-ring rounded px-2 py-1"
          onChange={event => draft.edit({ document: draft.document,
            name: event.target.value })} />
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {labels[draft.status]}
        </span>
        <button type="button" aria-label={labels.undo} disabled={!draft.canUndo}
          onClick={() => draft.undo()} className="px-1 disabled:opacity-30">↶</button>
        <button type="button" aria-label={labels.redo} disabled={!draft.canRedo}
          onClick={() => draft.undo(true)} className="px-1 disabled:opacity-30">↷</button>
        <button type="button" aria-label={labels.close}
          className="px-2 text-xl" onClick={close}>×</button>
      </header>
      <nav className="effects-tabs flex gap-2 px-4 py-2 border-b border-border"
        aria-label={labels.title}>
        {['templates', 'edit', 'preview'].map(value => <button key={value}
          type="button" aria-pressed={tab === value}
          className={`rounded px-3 py-1 text-sm ${tab === value ? 'bg-muted' : ''}`}
          onClick={() => setTab(value)}>{labels[value]}</button>)}
      </nav>
      {(error || !controller.capability?.ready) && <div role="status"
        className="border-b border-border px-5 py-2 text-xs flex gap-3">
        <span>{error ? t.effects.errors[code ?? ''] ?? labels.failed
          : labels.unavailable}</span>
        {!controller.capability?.ready && <button type="button"
          className="underline" onClick={() => void controller.run(async () => {
            await controller.refresh(true);
          })}>{labels.retry}</button>}
      </div>}
      {(draft.status === 'conflict' || draft.draft?.readOnly) &&
        <div className="px-5 py-2 border-b border-border text-xs flex gap-3">
          {draft.draft?.readOnly && <span>{labels.readOnly}</span>}
          <button type="button" className="underline" onClick={() =>
            draft.load({ name: draft.name, document: draft.document })}>
            {labels.copy}</button>
          {draft.draft && <button type="button" className="underline"
            onClick={() => void controller.run(async () => {
              await controller.open({ draftId: draft.draft!.id },
                { discardChanges: true });
            })}>{labels.reload}</button>}
        </div>}
      {controller.busy ? <p role="status" className="flex-1 p-8">{labels.loading}</p>
        : <div className="effects-columns flex-1 min-h-0" data-tab={tab}>
          <aside className="effects-library min-h-0 border-r border-border">
            <EffectsLibrary selected={draft.document.templateId}
              onSelect={controller.selectTemplate} />
          </aside>
          <main className="effects-preview min-h-0 bg-muted/20">
            {isValid && <EffectsPreview document={draft.document}
              assets={controller.assets} />}
          </main>
          <aside className="effects-inspector min-h-0 border-l border-border">
            <EffectsInspector controller={controller} materials={options.materials}
              lockSource={mode === 'replace' && !!controller.target} />
          </aside>
        </div>}
      <footer className="border-t border-border px-5 py-3 space-y-2">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2 text-xs">
            <select aria-label={labels.insert} value={mode}
              className="rounded border border-border bg-background p-1.5"
              onChange={event => setApplicationMode(event.target.value as typeof mode)}>
              <option value="insert">{labels.insert}</option>
              {controller.target && <option value="replace">{labels.replace}</option>}
            </select>
            <button type="button" onClick={() => void controller.reselect()}>
              {labels.reselect}</button>
          </div>
          <button type="button" disabled={!canRender}
            className="rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-40"
            onClick={() => void controller.render()}>{labels.render}</button>
        </div>
        {controller.jobs.jobs.length > 0 && <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {labels.jobs} · {controller.jobs.activeCount}
          </summary>
          <div className="mt-2 grid max-h-36 overflow-auto gap-2 sm:grid-cols-2">
            {controller.jobs.jobs.map(job => <EffectsJobCard key={job.id}
              job={job} controller={controller} mode={mode} />)}
          </div>
        </details>}
      </footer>
      {confirmClose && <div role="alertdialog" aria-modal="true"
        aria-label={labels.unsaved}
        className="absolute inset-0 z-10 grid place-items-center bg-background/80 p-6">
        <div className="rounded-lg border border-border bg-background shadow-xl p-5 space-y-4">
          <p>{labels.unsaved}</p>
          <div className="flex flex-wrap gap-3 text-sm">
            <button type="button" onClick={() => void controller.run(async () => {
              await draft.flush(); setConfirmClose(false); controller.close();
            })}>{labels.saveClose}</button>
            <button type="button" onClick={() => {
              setConfirmClose(false); controller.close();
            }}>{labels.discard}</button>
            <button type="button" onClick={() => setConfirmClose(false)}>{labels.continue}</button>
          </div>
        </div>
      </div>}
    </div>
    <style>{`
      .effects-studio { position:relative; width:min(1280px,96vw);
        height:min(860px,92vh); container-type:inline-size; }
      .effects-columns { display:grid; grid-template-columns:208px minmax(0,1fr) 288px; }
      .effects-tabs { display:none; }
      @container (max-width:1099px) {
        .effects-columns { grid-template-columns:minmax(0,1fr) 260px; }
        .effects-tabs { display:flex; }
        .effects-library { display:none; }
        .effects-columns[data-tab=templates] .effects-library {
          display:block; grid-column:1/-1; }
        .effects-columns[data-tab=templates] .effects-preview,
        .effects-columns[data-tab=templates] .effects-inspector { display:none; }
      }
      @container (max-width:899px) {
        .effects-columns { display:block; }
        .effects-library,.effects-preview,.effects-inspector { height:100%; display:none; }
        .effects-columns[data-tab=templates] .effects-library,
        .effects-columns[data-tab=preview] .effects-preview,
        .effects-columns[data-tab=edit] .effects-inspector { display:block; }
      }
    `}</style>
  </Modal>, document.body);
}
