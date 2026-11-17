import React, { useEffect, useRef, useState } from 'react';
import type { MaterialItem } from '@/types';
import type { EffectAsset, EffectDocument, EffectTemplate } from '@/types/effects';
import { useLocale } from '@/contexts/LocaleContext';
import { http } from '@/lib/api/http-client';

export function EffectsSourcePicker(options: {
  template: EffectTemplate; document: EffectDocument;
  materials: MaterialItem[]; assets: EffectAsset[];
  onChoose: (slot: string, material: MaterialItem) => Promise<unknown>;
  onChange: (document: EffectDocument) => void;
}) {
  const { t } = useLocale();
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const lifetime = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setUploading(false); setError('');
    return () => controller.abort();
  }, [options.template.id]);
  const remove = (index: number) => {
    let position = 0;
    const inputs = options.document.inputs.filter((_, i) => i !== index)
      .map(input => input.slot === 'images' ? { ...input, index: position++ } : input);
    options.onChange({ ...options.document, inputs });
  };
  const update = (index: number, patch: Partial<EffectDocument['inputs'][number]>) => {
    options.onChange({ ...options.document, inputs: options.document.inputs
      .map((binding, position) => position === index ? { ...binding, ...patch } : binding) });
  };
  const upload = async (slot: string, file: File) => {
    const signal = lifetime.current.signal;
    setUploading(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const uploaded = await http.upload<{ success: boolean; file_url: string }>(
        '/api/storage/upload-file', form, { signal });
      if (!uploaded.success) throw new Error(t.effects.labels.failed);
      if (signal.aborted) return;
      await options.onChoose(slot, { id: crypto.randomUUID(), name: file.name,
        type: 'image', url: uploaded.file_url, serverUrl: uploaded.file_url,
        size: file.size, format: file.name.split('.').pop() ?? 'png',
        createdAt: new Date() });
    } catch (error) {
      if (!signal.aborted) setError(error instanceof Error
        ? error.message : t.effects.labels.failed);
    } finally { if (!signal.aborted) setUploading(false); }
  };
  return <div className="space-y-3">
    {options.template.slots.map(slot => {
      const bindings = options.document.inputs.filter(input => input.slot === slot.id);
      return <div key={slot.id} className="rounded border border-border p-2 space-y-2">
        <span className="text-xs font-medium">
          {t.effects.labels[slot.id] ?? slot.id}{slot.required ? ' *' : ''}
        </span>
        {options.document.inputs.map((binding, index) => binding.slot === slot.id
          ? <div key={index} className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
            <span className="truncate flex-1">{options.assets.find(asset =>
              asset.id === binding.assetId)?.kind ?? t.effects.labels.missing}</span>
            <button type="button" onClick={() => remove(index)}>
              {t.effects.labels.remove}
            </button>
            </div>
            <label className="flex items-center justify-between gap-2">
              {t.effects.labels.fit}
              <select aria-label={t.effects.labels.fit} value={binding.fit}
                className="rounded bg-background border border-border p-1"
                onChange={event => update(index, { fit: event.target.value as 'cover' | 'contain' })}>
                <option value="cover">{t.effects.labels.cover}</option>
                <option value="contain">{t.effects.labels.contain}</option>
              </select>
            </label>
            {binding.fit === 'cover' && (['focalX', 'focalY'] as const).map(axis =>
              <label key={axis} className="flex items-center justify-between gap-2">
                {t.effects.labels[axis]}
                <input type="range" aria-label={t.effects.labels[axis]}
                  min="0" max="1" step="0.01" value={binding[axis]}
                  className="w-24 accent-primary" onChange={event =>
                    update(index, { [axis]: Number(event.target.value) })} />
              </label>)}
          </div> : null)}
        {bindings.length < slot.max && <>
          <select aria-label={`${t.effects.labels.choose} · ${t.effects.labels[slot.id]}`}
            value="" disabled={uploading}
            className="w-full rounded bg-background border border-border p-1.5 text-xs"
            onChange={event => {
              const material = options.materials.find(item => item.id === event.target.value);
              if (material) void options.onChoose(slot.id, material);
            }}>
            <option value="">{t.effects.labels.choose}</option>
            {options.materials.filter(material => slot.kinds.includes(
              material.type as 'image' | 'video')).map(material =>
              <option key={material.id} value={material.id}>{material.name}</option>)}
          </select>
          {slot.kinds.includes('image') && <label className="block text-xs cursor-pointer">
            {uploading ? t.effects.labels.loading : t.effects.labels.upload}
            <input type="file" accept="image/*" disabled={uploading}
              className="sr-only" onChange={event => {
                const file = event.target.files?.[0];
                if (file) void upload(slot.id, file);
                event.target.value = '';
              }} />
          </label>}
        </>}
      </div>;
    })}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
