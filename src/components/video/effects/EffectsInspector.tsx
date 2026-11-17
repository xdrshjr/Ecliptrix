import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { EffectDocument } from '@/types/effects';
import { getEffectTemplate } from '@/lib/effects/catalog';
import { getRenderedEffectFields } from '@/lib/effects/textLayout';
import { getEffectRenderability } from '@/lib/effects/validation';
import type { EffectsController } from './useEffectsController';
import type { MaterialItem } from '@/types';
import { EffectsSourcePicker } from './EffectsSourcePicker';

export function EffectsInspector(options: {
  controller: EffectsController; materials: MaterialItem[]; lockSource: boolean;
}) {
  const { t } = useLocale();
  const { controller } = options;
  const document = controller.draft.document;
  const template = getEffectTemplate(document.templateId);
  const change = (next: EffectDocument) => controller.draft.edit({
    name: controller.draft.name, document: next });
  const renderability = getEffectRenderability(document);
  const labels = t.effects.labels;
  return <fieldset disabled={controller.draft.draft?.readOnly}
    className="h-full overflow-y-auto p-4 space-y-5 text-sm">
    <section className="space-y-2">
      <h3 className="font-medium">{labels.content}</h3>
      {getRenderedEffectFields(document).map(key => <label key={key}
        className="block text-xs text-muted-foreground">
        {key === 'title' ? labels.titleText : labels.subtitle}
        <textarea rows={key === 'title' ? 2 : 3} value={document.content[key]}
          className="mt-1 block w-full rounded border border-border bg-background p-2 text-foreground"
          onChange={event => change({ ...document, content: {
            ...document.content, [key]: event.target.value } })} />
        <span>{Array.from(document.content[key]).length} / {key === 'title' ? 120 : 300}</span>
      </label>)}
      {!renderability.ready && <p role="status" className="text-xs text-primary">
        {labels.required}
      </p>}
    </section>
    <section className="space-y-2">
      <h3 className="font-medium">{labels.inputs}</h3>
      <EffectsSourcePicker template={template} document={document}
        assets={controller.assets} materials={options.materials}
        onChoose={controller.attach} onChange={change} />
    </section>
    <section className="space-y-2">
      <h3 className="font-medium">{labels.palette}</h3>
      <div className="flex justify-between gap-2">
        {(['background', 'foreground', 'accent'] as const).map(key =>
          <label key={key} className="text-xs">{labels[key]}
            <input type="color" value={document.palette[key]}
              className="block w-12 h-7 cursor-pointer"
              onChange={event => change({ ...document,
                palette: { ...document.palette, [key]: event.target.value } })} />
          </label>)}
      </div>
      <select aria-label={labels.typography} value={document.typography.family}
        className="w-full border border-border bg-background rounded p-1.5"
        onChange={event => change({ ...document, typography: {
          ...document.typography, family: event.target.value as 'sans' } })}>
        {['sans', 'serif', 'mono'].map(family => <option key={family}
          value={family}>{labels[family]}</option>)}
      </select>
      <select aria-label={labels.typography} value={document.typography.align}
        className="w-full border border-border bg-background rounded p-1.5"
        onChange={event => change({ ...document, typography: {
          ...document.typography, align: event.target.value as 'center' } })}>
        {['left', 'center', 'right'].map(align => <option key={align}
          value={align}>{labels[align]}</option>)}
      </select>
      <NumberField label={labels.scale} value={document.typography.scale}
        min={0.6} max={1.4} onChange={scale => change({ ...document,
          typography: { ...document.typography, scale } })} />
    </section>
    <section className="space-y-2">
      <h3 className="font-medium">{labels.animation}</h3>
      {(['speed', 'intensity'] as const).map(key => <NumberField key={key}
        label={labels[key]} value={document.motion[key]}
        min={key === 'speed' ? 0.5 : 0} max={key === 'speed' ? 2 : 1}
        onChange={value => change({ ...document,
          motion: { ...document.motion, [key]: value } })} />)}
      {Object.entries(template.parameterSchema).map(([key, schema]) =>
        schema.type === 'string' ? <label key={key} className="block text-xs">
          {t.effects.parameters[key]}
          {schema.enum ? <select value={String(document.params[key])}
            className="block w-full rounded border border-border bg-background p-1.5"
            onChange={event => change({ ...document,
              params: { ...document.params, [key]: event.target.value } })}>
            {schema.enum.map(value => <option key={value} value={value}>
              {value.endsWith('left') ? labels.left : labels.right}</option>)}
          </select> : <input value={String(document.params[key])}
            className="block w-full rounded border border-border bg-background p-1.5"
            onChange={event => change({ ...document,
              params: { ...document.params, [key]: event.target.value } })} />}
        </label> : schema.type === 'array'
          ? (document.params[key] as number[]).map((value, index) =>
            <NumberField key={`${key}-${index}`} label={`${t.effects.parameters[key]} ${index + 1}`}
              value={value} min={0} max={100} onChange={value => change({ ...document,
                params: { ...document.params, [key]: (document.params[key] as number[])
                  .map((old, i) => i === index ? value : old) } })} />)
          : <NumberField key={key} label={t.effects.parameters[key]}
            value={Number(document.params[key])} min={schema.minimum!}
            max={schema.maximum!} step={schema.type === 'integer' ? 1 : 0.01}
            onChange={value => change({ ...document,
              params: { ...document.params, [key]: value } })} />)}
    </section>
    <section className="space-y-2">
      <h3 className="font-medium">{labels.canvas}</h3>
      <select aria-label={labels.canvas} disabled={options.lockSource}
        value={`${document.canvas.width}:${document.canvas.height}`}
        className="w-full rounded border border-border bg-background p-1.5"
        onChange={event => {
          const [width, height] = event.target.value.split(':').map(Number);
          change({ ...document, canvas: { width, height, fps: 30 } });
        }}>
        <option value={`${document.canvas.width}:${document.canvas.height}`}>
          {document.canvas.width} × {document.canvas.height}</option>
        {[[1920, 1080], [1080, 1920], [1080, 1080], [1280, 720], [720, 1280], [720, 720]]
          .map(([w, h]) => <option key={`${w}:${h}`} value={`${w}:${h}`}>{w} × {h}</option>)}
      </select>
      <NumberField label={labels.duration} disabled={options.lockSource}
        value={document.durationFrames / 30} min={0.5} max={60} step={1 / 30}
        onChange={seconds => change({ ...document,
          durationFrames: Math.round(seconds * 30) })} />
    </section>
  </fieldset>;
}

function NumberField(options: { label: string; value: number;
  min: number; max: number; step?: number; disabled?: boolean;
  onChange: (value: number) => void }) {
  return <label className="flex items-center justify-between gap-2 text-xs">
    <span>{options.label}</span>
    <input type="number" value={Number(options.value.toFixed(3))}
      min={options.min} max={options.max} step={options.step ?? 0.05}
      disabled={options.disabled}
      className="w-20 rounded border border-border bg-background p-1.5 tabular-nums"
      onChange={event => {
        const value = event.target.valueAsNumber;
        if (Number.isFinite(value)) options.onChange(
          Math.min(options.max, Math.max(options.min, value)));
      }} />
  </label>;
}
