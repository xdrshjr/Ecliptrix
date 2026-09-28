'use client';
import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CoverDocument, CoverTextField } from '@/types/videoCover';
import type { MaterialItem } from '@/types';

export function CoverInspector({ document: doc, onChange, onUpload,
  onFrame, onMaterial, materials, hasFrame, onBlur, idPrefix, invalidFields = [] }: {
  idPrefix?: string; invalidFields?: CoverTextField[];
  document: CoverDocument; onChange: (d: CoverDocument) => void;
  onUpload: (blob: Blob) => void; onFrame: () => void;
  onMaterial: (url: string) => void; materials: MaterialItem[];
  hasFrame: boolean; onBlur: () => void;
}) {
  const { t } = useLocale(); const c = t.coverStudio;
  const changeBackground = (patch: Partial<CoverDocument['background']>) =>
    onChange({ ...doc, background: { ...doc.background, ...patch } });
  return <div className="cover-inspector" onBlur={onBlur}>
    {doc.mode !== 'ai' && <fieldset><legend>{c.content}</legend>
      {(['title', 'subtitle', 'label'] as const).map((key, index) =>
        <label key={key}>{key === 'title' ? c.titleField : c[key]}
          <textarea aria-label={key === 'title' ? c.titleField : c[key]}
            id={idPrefix ? `${idPrefix}-field-${key}` : undefined}
            aria-invalid={invalidFields.includes(key) || undefined}
            aria-describedby={idPrefix && invalidFields.includes(key)
              ? `${idPrefix}-readiness-text-overflow-${key}` : undefined}
            rows={key === 'title' ? 3 : 2} value={doc.fields[key]}
            onChange={event => {
              const value = Array.from(event.target.value).slice(0, [80, 160, 24][index]).join('');
              onChange({ ...doc, fields: { ...doc.fields, [key]: value } });
            }} />
          <small>{Array.from(doc.fields[key]).length} / {[80, 160, 24][index]}</small>
        </label>)}
      <label>{c.font}<select value={doc.typography.family} onChange={e =>
        onChange({ ...doc, typography: { ...doc.typography,
          family: e.target.value as CoverDocument['typography']['family'] } })}>
        <option value="sans">Segoe UI / 微软雅黑</option>
        <option value="serif">Georgia / 宋体</option><option value="mono">Consolas</option>
      </select></label>
      <label>{c.fontSize}<input type="range" min="0.5" max="1.5" step="0.01"
        value={doc.typography.titleScale} onChange={e => onChange({ ...doc,
          typography: { ...doc.typography, titleScale: Number(e.target.value) } })} /></label>
      <label>{c.align}<select value={doc.typography.align} onChange={e => onChange({
        ...doc, typography: { ...doc.typography, align: e.target.value as 'left' | 'center' | 'right' },
      })}><option value="left">←</option><option value="center">↔</option><option value="right">→</option></select></label>
      <div className="cover-color-row">{(['textColor', 'accentColor'] as const).map(key =>
        <label key={key}>{c[key]}<input type="color" value={doc.typography[key]}
          onChange={e => onChange({ ...doc, typography: { ...doc.typography, [key]: e.target.value } })} /></label>)}</div>
    </fieldset>}
    <fieldset><legend>{c.background}</legend>
      {doc.mode === 'html' && <div className="cover-color-row">
        <select aria-label={c.background} value={doc.background.kind} onChange={e => {
          const kind = e.target.value as CoverDocument['background']['kind'];
          changeBackground({ kind, assetId: kind === 'asset' ? doc.background.assetId : null });
        }}><option value="solid">{c.solid}</option><option value="gradient">{c.gradient}</option>
          <option value="asset" disabled={!doc.background.assetId}>{c.asset}</option></select>
        <input aria-label={c.background} type="color" value={doc.background.color}
          onChange={e => changeBackground({ color: e.target.value })} />
      </div>}
      <label className="cover-upload">{c.upload}<input type="file" accept="image/png,image/jpeg,image/webp"
        id={idPrefix ? `${idPrefix}-field-background` : undefined}
        onChange={e => { const file = e.target.files?.[0]; if (file) onUpload(file); e.target.value = ''; }} /></label>
      <button type="button" disabled={!hasFrame} onClick={onFrame}>{c.frame}</button>
      {!hasFrame && <p className="cover-muted">{c.frameUnavailable}</p>}
      <select aria-label={c.material} value="" onChange={e => { if (e.target.value) onMaterial(e.target.value); }}>
        <option value="">{c.material}</option>
        {materials.filter(m => m.type === 'image' && (m.serverUrl || m.url).startsWith('/api/storage/files/'))
          .map(m => <option key={m.id} value={m.serverUrl || m.url}>{m.name}</option>)}
      </select>
      {doc.background.kind === 'asset' && (['focusX', 'focusY'] as const).map(key =>
        <label key={key}>{c[key]}<input type="range" min="0" max="1" step="0.01"
          value={doc.background[key]} onChange={e => changeBackground({ [key]: Number(e.target.value) })} /></label>)}
    </fieldset>
    {doc.mode !== 'html' && <fieldset><legend>{c.prompt}</legend>
      <textarea aria-label={c.prompt} rows={4} value={doc.generation.prompt}
        onChange={e => onChange({ ...doc, generation: { ...doc.generation,
          prompt: Array.from(e.target.value).slice(0, 2000).join('') } })} />
      <label>{c.count}<select value={doc.generation.count} onChange={e => onChange({
        ...doc, generation: { ...doc.generation, count: Number(e.target.value) as 1 | 2 | 4 },
      })}>{[1, 2, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <p className="cover-muted">{c.generationResolution}</p>
    </fieldset>}
    <label>{c.duration}<input type="number" min="0.1" max="5" step={1 / 30}
      value={Number((doc.durationFrames / 30).toFixed(3))} onChange={e => {
        if (!Number.isFinite(e.target.valueAsNumber)) return;
        onChange({ ...doc, durationFrames: Math.max(3, Math.min(150, Math.round(e.target.valueAsNumber * 30))) });
      }} /></label>
  </div>;
}
