'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import type { CoverDocument, CoverRecoveryAction, CoverResourceTab,
  CoverRevision, CoverTextField } from '@/types/videoCover';
import { useLocale } from '@/contexts/LocaleContext';
import { CoverCanvas } from './CoverCanvas';
import { CoverTemplatePicker } from './CoverTemplatePicker';
import { CoverInspector } from './CoverInspector';
import { CoverResources } from './CoverResources';
import { CoverErrorPanel } from './CoverErrorPanel';
import { CoverReadinessPanel } from './CoverReadinessPanel';
import { useCoverReadiness } from './useCoverReadiness';
import { CoverPreviewDialog } from './CoverPreviewDialog';
import { coverSize, fitCoverPreview } from './layout';
import { applyCoverTemplate } from './templates';
import type { CoverController } from './useCoverController';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import SettingsPage from '@/components/settings/SettingsPage';
import './coverStudio.css';

function usePreviewBounds(ratio?: CoverDocument['aspectRatio'], hidden = false) {
  const [viewportNode, viewport] = useState<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = viewportNode;
    if (!node || hidden) { setBounds({ width: 0, height: 0 }); return; }
    const measure = () => setBounds(previous =>
      previous.width === node.clientWidth && previous.height === node.clientHeight
        ? previous : { width: node.clientWidth, height: node.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [ratio, hidden, viewportNode]);
  return { viewport, fit: fitCoverPreview(coverSize(ratio ?? '16:9'), bounds) };
}

function useNarrowLayout() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024);
  useEffect(() => {
    const measure = () => setNarrow(window.innerWidth < 1024);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return narrow;
}

// This component composes the studio's mutually exclusive surfaces and action
// routing; rendering stays together to keep the single inspector instance clear.
export function CoverStudio({ controller: state, onClose, frame, materials }: {
  controller: CoverController; onClose: () => void; frame?: Blob;
  materials: MaterialItem[];
}) {
  const { t } = useLocale(); const c = t.coverStudio; const id = useId();
  const [safeArea, setSafeArea] = useState(false);
  const [canvasNode, setCanvasNode] = useState<HTMLDivElement | null>(null);
  const [focusField, setFocusField] = useState<CoverTextField>();
  const [properties, setProperties] = useState(false);
  const [preview, setPreview] = useState<'draft' | CoverRevision>();
  const [settings, setSettings] = useState(false);
  const [rebuild, setRebuild] = useState(false);
  const [resourceTab, setResourceTab] = useState<CoverResourceTab>('images');
  const [chooseImage, setChooseImage] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const propertyTrigger = useRef<HTMLButtonElement>(null);
  const propertyDialog = useRef<HTMLDialogElement>(null);
  const propertyContent = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const studio = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  const returningFromSettings = useRef(false);
  const narrow = useNarrowLayout();
  const doc = state.document;
  const hasDocument = !!doc;
  const backgroundUrl = state.assets.find(a => a.assetId === doc?.background.assetId)?.url;
  const readiness = useCoverReadiness({ document: doc, backgroundUrl,
    readinessKey: state.readinessKey, canvasNode,
    enabled: !!doc && !state.loading && !settings });
  useEffect(() => {
    const node = studio.current; if (!node) return;
    const measure = () => {
      if (node.clientHeight > 0) setCompact(node.clientHeight < 440);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [hasDocument, settings]);
  const focusEntry = useRef<() => void>(() => undefined);
  focusEntry.current = () => {
    if (returningFromSettings.current) {
      returningFromSettings.current = false;
      (narrow ? propertyTrigger.current : settingsTrigger.current)?.focus();
    } else title.current?.focus();
  };
  // Resolve refs after responsive rendering has moved the single inspector.
  const focusProperties = useRef<() => void>(() => undefined);
  focusProperties.current = () => {
    if (propertyTrigger.current?.getClientRects().length) propertyTrigger.current.focus();
    else propertyContent.current?.querySelector<HTMLElement>('textarea,input,select')?.focus();
  };
  const { viewport, fit } = usePreviewBounds(doc?.aspectRatio, settings);
  const applied = useTimelineStore(s => s.tracks).flatMap(track =>
    track.items).find(item => item.metadata?.role === 'video-cover');
  const run = (task: () => Promise<unknown>) => void task().catch(state.setError);
  const close = () => run(async () => { await state.flush(); onClose(); });
  useEffect(() => {
    if (!settings && hasDocument) focusEntry.current();
  }, [hasDocument, settings]);
  useEffect(() => {
    const node = propertyDialog.current;
    if (!narrow || !properties || settings || !node) return;
    node.showModal();
    node.querySelector<HTMLElement>('button,textarea,input,select')?.focus();
    return () => {
      node.close();
      focusProperties.current();
    };
  }, [narrow, properties, settings]);
  useEffect(() => { if (!narrow) setProperties(false); }, [narrow]);
  useEffect(() => {
    const preserveFocus = () => {
      if (!narrow && window.innerWidth < 1024 &&
        propertyContent.current?.contains(window.document.activeElement)) {
        propertyTrigger.current?.focus();
      }
    };
    window.addEventListener('resize', preserveFocus);
    return () => window.removeEventListener('resize', preserveFocus);
  }, [narrow]);
  useEffect(() => {
    if (!chooseImage || (narrow && !properties)) return;
    propertyContent.current?.querySelector<HTMLInputElement>('input[type=file]')?.focus();
    setChooseImage(false);
  }, [chooseImage, properties, narrow]);
  useEffect(() => {
    if (!focusField || (narrow && !properties)) return;
    const input = propertyContent.current?.ownerDocument.getElementById(
      `${id}-field-${focusField}`);
    input?.focus(); input?.scrollIntoView?.({ block: 'nearest' });
    setFocusField(undefined);
  }, [focusField, properties, narrow, id]);
  const openSettings = () => {
    propertyDialog.current?.close(); setProperties(false);
    setPreview(undefined); setSettings(true);
  };
  const retryOriginal = () => {
    const issue = state.issue;
    if (issue?.revisionId) return run(() => state.restoreRevision(issue.revisionId!));
    if (issue?.operation === 'generate') return run(state.generate);
    run(() => state.act(issue?.retryAction ?? 'apply'));
  };
  const recover = (action: CoverRecoveryAction) => {
    switch (action) {
      case 'retry-save': return run(state.retrySave);
      case 'use-local': return run(() => state.resolveConflict('local'));
      case 'use-server': return run(() => state.resolveConflict('server'));
      case 'refresh-status': return state.refreshJobs();
      case 'refresh-resources': return run(state.refreshResources);
      case 'retry-revision': return state.issue?.revisionId &&
        run(() => state.retryRevision(state.issue!.revisionId!));
      case 'resume-submission': return run(state.resumeSubmission);
      case 'cancel-submission': return run(state.cancelSubmission);
      case 'regenerate': return run(state.generate);
      case 'retry-operation': return retryOriginal();
      case 'reload-initial': return run(() => state.reload());
      case 'choose-image': setProperties(narrow); setChooseImage(true); return;
      case 'rebuild': setRebuild(true); return;
      case 'dismiss': state.setError(undefined); return;
    }
  };
  if (settings) return <div className="cover-studio"><SettingsPage initialItem="model"
    onClose={() => {
      returningFromSettings.current = true; setSettings(false);
      run(state.refreshResources);
    }} /></div>;
  if (state.loading || !doc) return <section className="cover-studio" aria-busy={state.loading}>
    <button onClick={onClose}>{c.back}</button>
    <p role="status">{state.loading ? c.loading : c.error}</p>
    <CoverErrorPanel issue={state.issue} onAction={recover} />
  </section>;
  const dimensions = coverSize(doc.aspectRatio);
  const ready = readiness.result.status === 'ready';
  const generationDisabled = state.busy || state.canGenerate !== true ||
    !doc.generation.prompt.trim() || state.submittingGeneration ||
    state.hasUnknownSubmission || state.jobs.some(job =>
      job.status === 'queued' || job.status === 'running');
  const activityLabel = state.activity === 'preparing' ? c.preparing
    : state.activity === 'downloading' ? c.preparingDownload
      : state.activity === 'restoring' ? c.restoring
        : state.activity === 'applying' ? c.applying : '';
  const appliedRevision = state.revisions.find(revision =>
    revision.id === applied?.metadata?.cover?.revisionId);
  const inspector = <div ref={propertyContent}>
    <CoverInspector document={doc} onChange={state.update} materials={materials}
      idPrefix={id} invalidFields={readiness.result.issues.flatMap(issue =>
        issue.code === 'text-overflow' && issue.field ? [issue.field] : [])}
      hasFrame={!!frame} onFrame={() => frame && run(() => state.upload(frame))}
      onUpload={blob => run(() => state.upload(blob))}
      onMaterial={url => run(() => state.copyAsset(url))}
      onBlur={() => run(state.flush)} />
    {doc.mode !== 'html' && <div className="cover-generation">
      {state.canGenerate === false && <p>{c.missingKey}</p>}
      {state.canGenerate === undefined && <p>{c.capabilityUnknown}
        <button onClick={() => run(state.refreshResources)}>{c.refreshResources}</button></p>}
      <button data-cover-settings ref={settingsTrigger}
        onClick={openSettings}>{c.settings}</button>
      <button data-cover-generate disabled={generationDisabled}
        onClick={() => run(state.generate)}>
        {state.submittingGeneration ? c.submittingGeneration : c.generate}</button>
      <p className="cover-muted">{c.generationNotice}</p>
    </div>}
  </div>;
  const feedbackInDialog = narrow && properties;
  const feedback = <>
    <CoverErrorPanel issue={state.issue} onAction={recover} busy={state.busy} />
    {state.notice && <p className="cover-notice" role="status">
      {{ 'image-imported': c.imageImported,
        'image-import-failed': c.imageImportFailed,
        'restore-reflow': c.restoreReflow }[state.notice]}</p>}
    {state.hasUnknownSubmission && !state.issue?.actions.includes('resume-submission') &&
      <div role="status" className="cover-error"><p>{c.submissionUnknown}</p>
        <button disabled={state.submittingGeneration}
          onClick={() => run(state.resumeSubmission)}>{c.resumeSubmission}</button>
        <button disabled={state.submittingGeneration}
          onClick={() => run(state.cancelSubmission)}>{c.cancelSubmission}</button></div>}
    {rebuild && <div role="alert" className="cover-error"><p>{c.rebuildHint}</p>
      <button onClick={() => run(async () => {
        await state.act('rebuild'); setRebuild(false);
      })}>{c.rebuildConfirm}</button>
      <button onClick={() => setRebuild(false)}>{c.close}</button></div>}
    <CoverReadinessPanel idPrefix={id} result={readiness.result}
      onRetry={readiness.retry}
      onEditField={field => { setProperties(narrow); setFocusField(field); }}
      onChooseImage={() => { setProperties(narrow); setChooseImage(true); }} />
  </>;
  return <section ref={studio} className="cover-studio" data-compact={compact}
    aria-label={c.title}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (properties) setProperties(false); else if (!preview) close();
      }
      if (event.code === 'Space' || ((event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'z')) event.stopPropagation();
    }}>
    <header className="cover-header"><button onClick={close}>← {c.back}</button>
      <h2 tabIndex={-1} ref={title}>{c.title}</h2>
      <div role="tablist" aria-label={c.title}>
        {(['html', 'ai', 'mixed'] as const).map((mode, index, modes) =>
          <button key={mode} role="tab" id={`${id}-${mode}`}
            aria-controls={`${id}-mode-panel`} aria-selected={doc.mode === mode}
            tabIndex={doc.mode === mode ? 0 : -1}
            onClick={() => state.update({ ...doc, mode })} onKeyDown={event => {
              const direction = event.key === 'ArrowRight' ? 1
                : event.key === 'ArrowLeft' ? -1 : 0;
              if (!direction) return; event.preventDefault();
              const next = (index + direction + modes.length) % modes.length;
              state.update({ ...doc, mode: modes[next] });
              (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
            }}>{c[mode]}</button>)}
      </div><span className="cover-save" aria-live="polite">{c[state.saveState]}</span>
      <button ref={propertyTrigger} className="cover-properties-toggle"
        onClick={() => { setPreview(undefined); setProperties(true); }}>{c.properties}</button>
    </header>
    <div className="cover-body" role="tabpanel" id={`${id}-mode-panel`}
      aria-labelledby={`${id}-${doc.mode}`}>
      <aside className="cover-template-panel"><h3>{c.templates}</h3>
        <CoverTemplatePicker value={doc.templateId} aspectRatio={doc.aspectRatio}
          onChange={templateId => state.changeTemplate(applyCoverTemplate(doc, templateId))} />
        {state.canUndoTemplate && <button onClick={() => run(state.undoTemplate)}>
          {c.undoTemplate}</button>}
      </aside>
      <main className="cover-stage"><div className="cover-preview-controls">
        <span>{dimensions.width} × {dimensions.height} · {doc.aspectRatio}</span>
        <label><input type="checkbox" checked={safeArea}
          onChange={event => setSafeArea(event.target.checked)} />{c.safeArea}</label>
        <button data-cover-preview onClick={() => {
          setProperties(false); setPreview('draft');
        }}>{c.preview}</button>
      </div><div className="cover-viewport" ref={viewport}>
        {fit.scale > 0 ? <div ref={setCanvasNode} className="cover-preview-frame"
          style={{ width: fit.width, height: fit.height }}>
          <div style={{ transform: `scale(${fit.scale})`, transformOrigin: 'top left' }}>
            <CoverCanvas document={doc} backgroundUrl={readiness.previewBackgroundUrl}
              imageLoadKey={readiness.imageLoadKey} safeArea={safeArea} />
          </div></div> : <span className="cover-muted">{c.loading}</span>}
      </div>
      </main>
      {!narrow && <aside className="cover-property-panel">{inspector}</aside>}
    </div>
    <CoverResources compact={compact} assets={state.assets} jobs={state.jobs}
      revisionEntries={state.revisionEntries} selectedAssetId={doc.background.assetId}
      appliedRevisionId={applied?.metadata?.cover?.revisionId}
      tab={resourceTab} onTabChange={tab => {
        setResourceTab(tab);
        if (tab === 'revisions') run(state.refreshResources);
      }} busy={state.busy}
      connection={state.jobConnection} onRefresh={state.refreshJobs}
      onSelect={asset => run(() => state.selectAsset(asset))}
      onCancel={jobId => run(() => state.cancel(jobId))}
      onRegenerate={generationDisabled ? undefined : () => run(state.generate)}
      onPreview={revision => { setProperties(false); setPreview(revision); }}
      onRestore={revisionId => run(() => state.restoreRevision(revisionId))}
      onDownload={revisionId => run(() => state.downloadRevision(revisionId))}
      onRetry={revisionId => run(() => state.retryRevision(revisionId))}
      onPngUnavailable={state.markRevisionPngUnavailable} />
    {!feedbackInDialog && feedback}
    <footer className="cover-footer"><div aria-live="polite">
      {applied ? `${c.videoUsing}：${appliedRevision
        ? c[appliedRevision.document.templateId] : c.cover} · ${applied.duration}s` : c.noCover}
      {applied && <small>{state.draftChanged === undefined ? c.comparisonUnavailable
        : state.draftChanged ? c.updated : c.applied}</small>}
      {activityLabel && <small>{activityLabel}</small>}
    </div>
      {state.canUndoRestore && <button onClick={() => run(state.undoRestore)}>
        {c.undoRestore}</button>}
      {state.legacyAvailable && <button onClick={() => run(state.importLegacy)}>{c.legacy}</button>}
      <button disabled={state.busy || !ready}
        aria-describedby={`${id}-readiness`}
        onClick={() => run(() => state.act('download'))}>{c.download}</button>
      <button className="cover-apply" disabled={state.busy || !ready}
        aria-describedby={`${id}-readiness`}
        onClick={() => run(() => state.act('apply'))}>{c.apply}</button>
    </footer>
    {narrow && <dialog ref={propertyDialog} className="cover-properties-dialog"
      aria-labelledby={`${id}-properties`} onCancel={event => {
        event.preventDefault(); event.stopPropagation(); setProperties(false);
      }} onClose={() => setProperties(false)} onKeyDown={event => {
        if (event.key === 'Escape') event.stopPropagation();
      }}>
      <header><h3 id={`${id}-properties`}>{c.properties}</h3>
        <button onClick={() => setProperties(false)}>{c.close}</button></header>
      {inspector}
      {feedbackInDialog && feedback}
    </dialog>}
    <CoverPreviewDialog open={!!preview}
      title={preview && preview !== 'draft'
        ? `${c.revisionDetails} · ${preview.id}` : c.preview}
      document={preview === 'draft' ? doc : undefined}
      backgroundUrl={backgroundUrl} imageUrl={preview && preview !== 'draft' ? preview.url : undefined}
      onClose={() => setPreview(undefined)} onFocusFallback={() =>
        studio.current?.querySelector<HTMLElement>(
          `[data-cover-resource-tab="${resourceTab}"]`)?.focus()}
      onImageError={() => {
        if (preview && preview !== 'draft') state.markRevisionPngUnavailable(preview.id);
        setPreview(undefined);
      }} />
  </section>;
}
