import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { EffectDocument } from '@/types/effects';
import { getEffectTemplate } from '@/lib/effects/catalog';
import { getRenderedEffectFields } from '@/lib/effects/textLayout';
import { effectParameterValidator, getEffectRenderability } from '@/lib/effects/validation';
import type { EffectsController } from './useEffectsController';
import type { MaterialItem } from '@/types';
import { EffectsSourcePicker } from './EffectsSourcePicker';

const counterFields: Partial<Record<string, string[]>> = {
  'counter-bars': ['bars'],
  'counter-up': ['value', 'suffix'],
};

export function EffectsInspector(options: {
  controller: EffectsController; materials: MaterialItem[]; lockSource: boolean;
}) {
  const { t } = useLocale();
  const { controller } = options;
  const document = controller.draft.document;
  const template = getEffectTemplate(document.templateId);
  const fields = Object.entries(template.parameterSchema);
  const visibleKeys = counterFields[template.id];
  const visibleFields = visibleKeys ? fields.filter(([key]) => visibleKeys.includes(key)) : fields;
  const invalidHiddenFields = visibleKeys ? fields.filter(([key, schema]) =>
    !visibleKeys.includes(key) && !effectParameterValidator(schema).safeParse(document.params[key]).success) : [];
  const change = (next: EffectDocument) => controller.draft.edit({
    name: controller.draft.name, document: next });
  const renderability = getEffectRenderability(document);
  const labels = t.effects.labels;
  const editable = controller.isEditor && !controller.draft.draft?.readOnly;
  return <fieldset key={`${controller.draft.getId()}:${template.id}:${editable}`} disabled={!editable}
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
      {visibleFields.map(([key, schema]) =>
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
      {invalidHiddenFields.map(([key]) => <div key={key} className="space-y-1 text-xs">
        <p role="status">{labels.invalidHiddenParameter.replace('{field}', t.effects.parameters[key])}</p>
        <button type="button" className="underline disabled:opacity-50"
          onClick={() => change({ ...document, params: { ...document.params,
            [key]: structuredClone(template.defaults[key]) } })}>
          {labels.resetParameter.replace('{field}', t.effects.parameters[key])}
        </button>
      </div>)}
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
      <NumberField key={String(options.lockSource)} label={labels.duration} disabled={options.lockSource}
        value={document.durationFrames / 30} min={0.5} max={60} step={1 / 30}
        stepValue={(seconds, direction) => (Math.round(seconds * 30) + direction) / 30}
        onChange={seconds => {
          const durationFrames = Math.round(seconds * 30);
          if (durationFrames !== document.durationFrames) change({ ...document, durationFrames });
        }} />
    </section>
  </fieldset>;
}

const formatNumber = (value: number) => String(Number(value.toFixed(3)));

function NumberField(options: { label: string; value: number;
  min: number; max: number; step?: number; disabled?: boolean;
  stepValue?: (value: number, direction: number) => number;
  onChange: (value: number) => void }) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const messageId = useId();
  const [message, setMessage] = useState('');
  const displayed = formatNumber(options.value);
  // 浏览器保留输入中的小数点。只有已提交的字段值改变时才同步回显。
  useLayoutEffect(() => {
    if (input.current) input.current.value = displayed;
    setMessage('');
  }, [options.value, displayed]);
  const clamp = (value: number) => Math.min(options.max, Math.max(options.min, value));
  const commit = (field: HTMLInputElement) => {
    if (field.matches(':disabled') || field.value === displayed) return;
    const value = field.valueAsNumber;
    field.value = displayed;
    if (!Number.isFinite(value) || (options.step === 1 && !Number.isInteger(value))) {
      setMessage(options.step === 1 ? t.effects.labels.integerRequired : t.effects.labels.numberRequired);
      return;
    }
    const next = clamp(value);
    if (next !== options.value) options.onChange(next);
  };
  return <div className="text-xs">
    <label className="flex items-center justify-between gap-2">
      <span>{options.label}</span>
      <input ref={input} type="number" defaultValue={displayed}
        min={options.min} max={options.max} step={options.step ?? 0.05}
        disabled={options.disabled} aria-describedby={message ? messageId : undefined}
        className="w-20 rounded border border-border bg-background p-1.5 tabular-nums"
        onChange={() => setMessage('')}
        onBlur={event => commit(event.currentTarget)}
        onKeyDown={event => {
          const field = event.currentTarget;
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(field);
          } else if (event.key === 'Escape') {
            // 关闭工作台的快捷键会在输入框失焦前检查草稿。
            commit(field);
          } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            field.value = displayed;
            setMessage('');
          } else if (options.stepValue && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            const value = Number.isFinite(field.valueAsNumber) ? field.valueAsNumber : options.value;
            const stepped = options.stepValue(value, event.key === 'ArrowUp' ? 1 : -1);
            field.value = formatNumber(clamp(stepped));
            setMessage('');
          }
        }} />
    </label>
    {message && <p role="status" id={messageId} className="mt-1 text-muted-foreground">{message}</p>}
  </div>;
}
