'use client';
import React, { useEffect, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import type { CoverDocument, CoverMode } from '@/types/videoCover';
import { useLocale } from '@/contexts/LocaleContext';
import { CoverCanvas } from './CoverCanvas';
import { CoverTemplatePicker } from './CoverTemplatePicker';
import { CoverInspector } from './CoverInspector';
import { CoverCandidates } from './CoverCandidates';
import { coverSize } from './layout';
import { applyCoverTemplate } from './templates';
import type { CoverController } from './useCoverController';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import SettingsPage from '@/components/settings/SettingsPage';
import './coverStudio.css';

export function CoverStudio({ controller: state, onClose, frame, materials }: {
  controller: CoverController; onClose: () => void; frame?: Blob;
  materials: MaterialItem[];
}) {
  const { t } = useLocale(); const c = t.coverStudio;
  const [safeArea, setSafeArea] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [properties, setProperties] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rebuild, setRebuild] = useState(false);
  const [undoTemplate, setUndoTemplate] = useState<CoverDocument>();
  const viewport = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [scale, setScale] = useState(.2);
  const applied = useTimelineStore(s => s.tracks).flatMap(track =>
    track.items).find(item => item.metadata?.role === 'video-cover');
  const run = (task: () => Promise<unknown>) => void task().catch(state.setError);
  const close = () => run(async () => { await state.flush(); onClose(); });
  const doc = state.document;
  useEffect(() => {
    const node = viewport.current; if (!node || !doc) return;
    const measure = () => {
      const size = coverSize(doc.aspectRatio);
      setScale(Math.max(.05, Math.min((node.clientWidth - 48) / size.width,
        (node.clientHeight - 48) / size.height)));
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [doc?.aspectRatio, state.loading, settings]);
  useEffect(() => {
    if (enlarged) dialog.current?.showModal(); else dialog.current?.close();
  }, [enlarged]);
  if (settings) return <div className="cover-studio"><SettingsPage initialItem="model"
    onClose={() => { setSettings(false); run(() => state.reload()); }} /></div>;
  if (state.loading || !doc) return <section className="cover-studio" aria-busy={state.loading}>
    <button onClick={onClose}>{c.back}</button><p role="status">{state.loading ? c.loading : c.error}</p>
    {state.error != null && <button onClick={() => run(() => state.reload())}>{c.retry}</button>}
  </section>;
  const dimensions = coverSize(doc.aspectRatio);
  const backgroundUrl = state.assets.find(a => a.assetId === doc.background.assetId)?.url;
  const errorCode = state.error && typeof state.error === 'object' && 'code' in state.error
    ? String(state.error.code) : undefined;
  const ready = !overflow && (doc.mode === 'ai' || !!`${doc.fields.title}${doc.fields.subtitle}`.trim())
    && (doc.mode === 'html' || (doc.background.kind === 'asset' && !!backgroundUrl));
  return <section className="cover-studio" aria-label={c.title}
    onKeyDown={e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (properties) setProperties(false); else if (!enlarged) close();
      }
      if (e.code === 'Space' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) e.stopPropagation();
    }}>
    <header className="cover-header"><button onClick={close}>← {c.back}</button>
      <h2>{c.title}</h2><div role="tablist" aria-label={c.title}>
        {(['html', 'ai', 'mixed'] as const).map((mode, index, modes) => <button key={mode}
          role="tab" aria-selected={doc.mode === mode} tabIndex={doc.mode === mode ? 0 : -1}
          onClick={() => state.update({ ...doc, mode })} onKeyDown={e => {
            const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!direction) return; e.preventDefault();
            const next = (index + direction + 3) % 3;
            state.update({ ...doc, mode: modes[next] as CoverMode });
            (e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
          }}>{c[mode]}</button>)}
      </div><span className="cover-save" aria-live="polite">{c[state.saveState]}</span>
      <button className="cover-properties-toggle" onClick={() => setProperties(!properties)}>{c.properties}</button>
    </header>
    <div className="cover-body">
      <aside className="cover-template-panel"><h3>{c.templates}</h3>
        <CoverTemplatePicker value={doc.templateId} onChange={id => {
          setUndoTemplate(doc); state.update(applyCoverTemplate(doc, id));
        }} />{undoTemplate && <button onClick={() => { state.update(undoTemplate); setUndoTemplate(undefined); }}>{c.undoTemplate}</button>}
      </aside>
      <main className="cover-stage"><div className="cover-preview-controls">
        <span>{dimensions.width} × {dimensions.height} · {doc.aspectRatio}</span>
        <label><input type="checkbox" checked={safeArea} onChange={e => setSafeArea(e.target.checked)} />{c.safeArea}</label>
        <button onClick={() => setEnlarged(true)}>{c.preview}</button>
      </div><div className="cover-viewport" ref={viewport}>
        <div className="cover-preview-frame" style={{ width: dimensions.width * scale, height: dimensions.height * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <CoverCanvas document={doc} backgroundUrl={backgroundUrl}
              safeArea={safeArea} onOverflow={setOverflow} />
          </div>
        </div>
      </div>
      {overflow && <p role="alert" className="cover-error">{c.overflow}</p>}
      <CoverCandidates jobs={state.jobs} value={doc.background.assetId}
        onSelect={asset => run(() => state.selectAsset(asset))}
        onCancel={id => run(() => state.cancel(id))} />
      </main>
      <aside className="cover-property-panel" data-open={properties}>
        <button className="cover-properties-toggle" onClick={() => setProperties(false)}>{c.close}</button>
        <CoverInspector document={doc} onChange={state.update} materials={materials}
          hasFrame={!!frame} onFrame={() => frame && run(() => state.upload(frame))}
          onUpload={blob => run(() => state.upload(blob))}
          onMaterial={url => run(() => state.copyAsset(url))}
          onBlur={() => run(state.flush)} />
        {doc.mode !== 'html' && <div className="cover-generation">
          {state.canGenerate === false && <p>{c.missingKey} <button onClick={() => setSettings(true)}>{c.settings}</button></p>}
          <button disabled={state.canGenerate === false || !doc.generation.prompt.trim() || state.jobs.some(j => j.status === 'queued' || j.status === 'running')}
            onClick={() => run(state.generate)}>{c.generate}</button>
          <p className="cover-muted">{c.generationNotice}</p>
        </div>}
      </aside>
    </div>
    {!!state.error && <div className="cover-error" role="alert">
      {errorCode ? c.errors[errorCode] ?? c.error : c.error}
      <button onClick={() => run(() => state.reload())}>{c.reload}</button>
      <button onClick={() => run(() => state.reload(true))}>{c.overwrite}</button>
      {errorCode === 'COVER_TIMELINE_CONFLICT' && <button onClick={() => setRebuild(true)}>{c.rebuild}</button>}
    </div>}
    {rebuild && <div role="alert"><p>{c.rebuildHint}</p>
      <button onClick={() => run(async () => { await state.act('rebuild'); setRebuild(false); })}>{c.rebuildConfirm}</button>
      <button onClick={() => setRebuild(false)}>{c.close}</button></div>}
    <footer className="cover-footer"><div aria-live="polite">
      {applied ? `${c.appliedVersion} ${String(applied.metadata?.cover?.revisionId).slice(0, 8)} · ${applied.duration}s` : c.noCover}
      {applied && state.draftChanged && <small>{c.updated}</small>}
    </div>{state.legacyAvailable && <button onClick={() => run(state.importLegacy)}>{c.legacy}</button>}
      <button disabled={state.busy || !ready} onClick={() => run(() => state.act('download'))}>{c.download}</button>
      <button className="cover-apply" disabled={state.busy || !ready}
        onClick={() => run(() => state.act('apply'))}>{state.busy ? c.applying : c.apply}</button>
    </footer>
    <dialog ref={dialog} className="cover-enlarged" onClose={() => setEnlarged(false)}>
      <button autoFocus onClick={() => setEnlarged(false)}>{c.close}</button>
      <div style={{ width: dimensions.width * Math.min(.6, 800 / dimensions.width),
        height: dimensions.height * Math.min(.6, 800 / dimensions.width), overflow: 'hidden' }}>
        <div style={{ transform: `scale(${Math.min(.6, 800 / dimensions.width)})`, transformOrigin: 'top left' }}>
          <CoverCanvas document={doc} backgroundUrl={backgroundUrl} /></div>
      </div>
    </dialog>
  </section>;
}
