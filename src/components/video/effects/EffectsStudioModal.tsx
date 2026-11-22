'use client';
import React, { useEffect, useRef, useState } from 'react';
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
import { EffectsCloseDialog } from './EffectsCloseDialog';

const EffectsPreview = dynamic(() => import('./EffectsPreview'), { ssr: false });

export function EffectsStudioModal(options: {
  controller: EffectsController; materials: MaterialItem[];
}) {
  const { t } = useLocale();
  const { controller } = options;
  const [tab, setTab] = useState('edit');
  const [applicationMode, setApplicationMode] = useState<'insert' | 'replace'>();
  const [confirmClose, setConfirmClose] = useState(false);
  const composing = useRef(false);
  const draftSelect = useRef<HTMLSelectElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const moreDrafts = useRef<HTMLButtonElement>(null);
  const hadMoreFocus = useRef(false);
  useEffect(() => {
    if (!controller.draftList.nextCursor && hadMoreFocus.current) {
      hadMoreFocus.current = false;
      if (draftSelect.current && !draftSelect.current.disabled) draftSelect.current.focus();
      else title.current?.focus();
    }
  }, [controller.draftList.nextCursor]);
  useEffect(() => {
    setApplicationMode(undefined);
    setConfirmClose(false);
  }, [controller.isOpen, controller.target, controller.editorEpoch]);
  if (!controller.isOpen) return null;
  const { draft } = controller;
  const mode = controller.target ? applicationMode ?? 'replace' : 'insert';
  const labels = t.effects.labels;
  let isValid = true;
  try { validateEffectDocument(draft.document); } catch { isValid = false; }
  const canRender = isValid && getEffectRenderability(draft.document).ready
    && controller.capability?.ready && draft.status !== 'conflict'
    && !draft.draft?.readOnly && !controller.busy && controller.isEditor
    && !controller.submission.pending && draft.status !== 'uncertain'
    && draft.document.inputs.every(input => controller.assets.some(asset =>
      asset.id === input.assetId));
  const close = () => {
    if (confirmClose) { setConfirmClose(false); return; }
    if (draft.isDirty() || draft.status === 'saving') setConfirmClose(true);
    else void controller.run(() => controller.close());
  };
  const error = controller.error ?? draft.error ?? controller.submission.error
    ?? controller.jobs.error;
  const code = error && 'code' in error ? String(error.code) : error?.message;
  return createPortal(<Modal isOpen onClose={close}
    labelledBy="effects-studio-title" closeOnBackdrop={false}
    contentClassName="effects-studio flex flex-col bg-background text-foreground rounded-xl border border-border shadow-2xl overflow-hidden"
  >
    <div data-effects-studio className="flex flex-col flex-1 min-h-0"
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; }}
      onKeyDownCapture={event => {
        if (composing.current || event.nativeEvent.isComposing
          || event.keyCode === 229) { event.stopPropagation(); return; }
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
        if (!event.nativeEvent.isComposing && !composing.current
          && event.keyCode !== 229 && (event.ctrlKey || event.metaKey)
          && event.key.toLowerCase() === 'z') {
          event.preventDefault(); draft.undo(event.shiftKey);
        }
      }}>
      <div inert={confirmClose}
        className="flex flex-col flex-1 min-h-0">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <h2 ref={title} tabIndex={-1} id="effects-studio-title" className="font-medium whitespace-nowrap">
          {labels.title}
        </h2>
        <select ref={draftSelect} aria-label={labels.drafts} value={draft.draft?.id ?? ''}
          disabled={!controller.isEditor}
          className="max-w-40 rounded border border-border bg-background p-1 text-xs"
          onChange={event => void controller.open(event.target.value
            ? { draftId: event.target.value } : { newDraft: true })}>
          <option value="">{labels.newDraft}</option>
          {controller.drafts.map(item => <option key={item.id} value={item.id}>
            {item.id === draft.draft?.id ? draft.name : item.name} · {item.id.slice(0, 8)}</option>)}
          {draft.draft && !controller.drafts.some(item => item.id === draft.draft!.id)
            && <option value={draft.draft.id}>{draft.name} · {draft.draft.id.slice(0, 8)}</option>}
        </select>
        {controller.draftList.nextCursor && <button ref={moreDrafts} type="button"
          className="h-8 rounded border border-border px-2 text-xs disabled:opacity-50"
          disabled={controller.draftList.loadingMore}
          onFocus={() => { hadMoreFocus.current = true; }}
          onBlur={event => { if (event.relatedTarget) hadMoreFocus.current = false; }}
          onClick={() => void controller.draftList.loadMore()}>
          {controller.draftList.loadingMore ? labels.loadingDrafts : labels.loadMoreDrafts}
        </button>}
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {controller.draftList.loadingMore ? labels.loadingDrafts : ''}</span>
        <input aria-label={labels.name} value={draft.name}
          readOnly={draft.draft?.readOnly || !controller.isEditor}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none focus:ring-1 focus:ring-ring rounded px-2 py-1"
          onChange={event => draft.edit({ document: draft.document,
            name: event.target.value })} />
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {labels[draft.status]}
        </span>
        <button type="button" aria-label={labels.undo} disabled={!draft.canUndo || !controller.isEditor}
          onClick={() => draft.undo()} className="px-1 disabled:opacity-30">↶</button>
        <button type="button" aria-label={labels.redo} disabled={!draft.canRedo || !controller.isEditor}
          onClick={() => draft.undo(true)} className="px-1 disabled:opacity-30">↷</button>
        <button type="button" aria-label={labels.close}
          className="px-2 text-xl" onClick={close}>×</button>
      </header>
      {controller.draftList.error && <div role="status" className="flex gap-3 px-5 py-2 text-xs">
        <span>{labels.draftListFailed}</span>
        <button type="button" className="underline" onClick={() => void (
          controller.draftList.errorPhase === 'load-more'
            ? controller.draftList.loadMore() : controller.draftList.refresh())}>{labels.retryDrafts}</button>
      </div>}
      {draft.restored && <p role="status" className="px-5 py-2 text-xs">
        {labels.restored}</p>}
      {(controller.submission.pending || draft.status === 'uncertain') &&
        <div role="status" className="flex gap-3 border-b border-border px-5 py-2 text-xs">
          <span>{labels.uncertain}</span>
          <button type="button" className="underline" onClick={() =>
            void controller.run(async () => {
              if (draft.status === 'uncertain') {
                await draft.restore(); await draft.flush();
              }
              await controller.submission.recover();
            })}>{labels.recheck}</button>
        </div>}
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
            void controller.run(async () => {
              if (draft.status === 'conflict') await draft.discardConflict();
              else {
                if (draft.hasPending()) throw new Error('EFFECT_SUBMISSION_UNKNOWN');
                await draft.discard();
              }
              controller.forgetRecoveredDraft();
              draft.load({ name: draft.name, document: draft.document });
            })}>
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
            <fieldset disabled={!controller.isEditor || draft.draft?.readOnly}
              className="h-full min-h-0">
              <EffectsInspector controller={controller} materials={options.materials}
                lockSource={mode === 'replace' && !!controller.target} />
            </fieldset>
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
            <button type="button" disabled={!controller.isEditor}
              onClick={() => void controller.reselect()}>
              {labels.reselect}</button>
          </div>
          <button type="button" disabled={!canRender}
            className="rounded-md bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-40"
            onClick={() => void controller.render()}>{labels.render}</button>
        </div>
        {Object.keys(controller.jobs.listErrors).length > 0 &&
          <div role="status" className="flex gap-3 text-xs">
            <span>{labels.listQueryFailed}</span>
            <button type="button" className="underline"
              onClick={() => void controller.jobs.retryLists()}>{labels.recheck}</button>
          </div>}
        {(controller.jobs.jobs.length > 0 || controller.jobs.nextCursor) && <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {labels.jobs} · {controller.jobs.activeCount}
          </summary>
          <div className="mt-2 grid max-h-36 overflow-auto gap-2 sm:grid-cols-2">
            {controller.jobs.jobs.map(job => <EffectsJobCard key={job.id}
              job={job} controller={controller} mode={mode} />)}
          </div>
          {controller.jobs.nextCursor && <button type="button"
            className="mt-2 underline" disabled={controller.jobs.loadingMore}
            onClick={() => void controller.jobs.loadMore()}>{labels.loadMore}</button>}
        </details>}
      </footer>
      </div>
      {!controller.isEditor && !controller.busy && <div role="status"
        className="absolute inset-x-0 top-0 flex items-center justify-between border-b border-border bg-background p-5 text-sm">
        <span>{labels.otherEditor}</span>
        <button type="button" onClick={() => void controller.close()}>
          {labels.close}</button>
      </div>}
      {confirmClose && <EffectsCloseDialog
        onContinue={() => setConfirmClose(false)}
        onSave={() => draft.flush()}
        onDiscard={() => draft.discard()}
        onClosed={async () => { await controller.close(); setConfirmClose(false); }} />}
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
